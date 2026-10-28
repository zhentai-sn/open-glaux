"""安装子进程入口（SDD 25 §7.4–§7.5）。

独立运行：``python -m app.packs.installer <pack-id>``。父进程只负责 spawn 与读状态，
**下载、校验、建 venv、装依赖全部在这里完成**，主 FastAPI 进程不 import httpx 之外的重量级依赖。

阶段序列：``resolving → downloading → verifying → installing → finalizing``。
模型 pack 走完整序列；runtime pack 无权重文件，跳过 downloading/verifying 直接进 installing。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .. import config
from . import registry as reg

DISK_HEADROOM = 1.2
PROGRESS_MIN_INTERVAL = 0.5
HEARTBEAT_INTERVAL = 5.0
CHUNK = 1 << 20

TMP_SUFFIX = ".partial"


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class _Reporter:
    """把阶段、字节进度与心跳写到 pack 目录，父进程只读这些文件（无进程间通道）。"""

    def __init__(self, pack_id: str) -> None:
        self.pack_id = pack_id
        self.root = reg.pack_root(pack_id)
        self.root.mkdir(parents=True, exist_ok=True)
        self._last_progress = 0.0
        self._last_heartbeat = 0.0
        self.phase = "resolving"
        self.bytes_done = 0
        self.bytes_total = 0

    def state(self, **fields: Any) -> None:
        current = reg.read_state(self.pack_id) or {}
        current.update(fields)
        current["heartbeat_at"] = _now_iso()
        reg.write_state(self.pack_id, current)

    def progress(
        self,
        *,
        phase: str | None = None,
        done: int | None = None,
        total: int | None = None,
        error: str | None = None,
        force: bool = False,
    ) -> None:
        if phase is not None:
            self.phase = phase
        if done is not None:
            self.bytes_done = done
        if total is not None:
            self.bytes_total = total
        now = time.monotonic()
        if not force and now - self._last_progress < PROGRESS_MIN_INTERVAL:
            return
        self._last_progress = now
        payload = {
            "phase": self.phase,
            "bytes_done": self.bytes_done,
            "bytes_total": self.bytes_total,
            "updated_at": _now_iso(),
            "error": error,
        }
        target = reg.progress_file(self.pack_id)
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)

    def heartbeat(self, force: bool = False) -> None:
        now = time.monotonic()
        if force or now - self._last_heartbeat >= HEARTBEAT_INTERVAL:
            self._last_heartbeat = now
            self.state(pid=os.getpid())


def _mirror(url: str, mirror: str) -> str:
    """把 URL 的 scheme+host 前缀换成镜像前缀（``https://hf-mirror.com`` → 同路径）。"""
    if not mirror:
        return url
    base = mirror.rstrip("/")
    rest = url.split("://", 1)[-1]
    slash = rest.find("/")
    path = rest[slash:] if slash >= 0 else "/"
    return f"{base}{path}"


def _http_client(proxy: str):
    import httpx

    kwargs: dict[str, Any] = {
        "timeout": httpx.Timeout(60.0, connect=20.0),
        "follow_redirects": True,
        "headers": {"User-Agent": "glaux-pack-installer/1"},
    }
    if proxy:
        kwargs["proxy"] = proxy
        try:
            return httpx.Client(**kwargs)
        except TypeError:  # httpx < 0.28 用 proxies=
            kwargs.pop("proxy")
            kwargs["proxies"] = proxy
            return httpx.Client(**kwargs)
    return httpx.Client(**kwargs)


def _download_one(client: Any, url: str, dest: Path, expected: int, reporter: _Reporter,
                  done_base: int, total: int) -> str:
    """流式下载到 dest，边下边算 sha256，返回十六进制摘要。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    written = 0
    with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in resp.iter_bytes(CHUNK):
                if not chunk:
                    continue
                fh.write(chunk)
                hasher.update(chunk)
                written += len(chunk)
                reporter.progress(done=done_base + written, total=total)
                reporter.heartbeat()
    if expected and written != expected:
        raise RuntimeError(f"字节数不符：期望 {expected}，实际 {written}")
    return hasher.hexdigest()


def _cleanup_staging(pack_id: str) -> None:
    """删除下载暂存目录；失败路径必须调用，不留半装产物。"""
    staging = reg.pack_root(pack_id).with_name(pack_id + TMP_SUFFIX)
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)


def _disk_ok(root: Path, need: int) -> bool:
    probe = root
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    free = shutil.disk_usage(probe).free
    return free >= int(need * DISK_HEADROOM)


def _uv_binary() -> str | None:
    """uv 的位置：PATH 优先，其次用户级安装目录（SDD 24 的安装脚本会装 uv）。"""
    found = shutil.which("uv")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "uv"
    return str(local) if local.is_file() else None


def _install_runtime(spec: reg.PackSpec, reporter: _Reporter) -> None:
    """建共享环境并装依赖。

    优先 uv：Debian/Ubuntu 常缺 ``python3.12-venv``（ensurepip 不可用），``python -m venv``
    会直接失败；uv 自带 venv 与 pip 能力，也免去引导 pip 的一步。
    """
    target = reg.pack_root(spec.id)
    venv_dir = target / ".venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    reporter.progress(phase="installing", force=True)

    uv = _uv_binary()
    if uv:
        subprocess.run([uv, "venv", str(venv_dir), "--python", "3.12"], check=True)
        py = config.venv_python(venv_dir)
        if not py.is_file():
            raise RuntimeError("uv 创建 venv 后找不到解释器")
        cmd = [uv, "pip", "install", "--python", str(py)]
    else:
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        py = config.venv_python(venv_dir)
        if not py.is_file():
            raise RuntimeError("venv 创建后找不到解释器")
        cmd = [str(py), "-m", "pip", "install", "--disable-pip-version-check", "--no-input"]

    if spec.index_url:
        cmd += ["--index-url", spec.index_url]
    cmd += list(spec.requirements)
    subprocess.run(cmd, check=True)
    reporter.progress(phase="finalizing", force=True)


def _install_model(spec: reg.PackSpec, reporter: _Reporter) -> None:
    total = sum(f.bytes for f in spec.files)
    staging = reg.pack_root(spec.id).with_name(spec.id + TMP_SUFFIX)
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    reporter.progress(phase="downloading", done=0, total=total, force=True)
    mirror = config.PACK_MIRROR
    proxy = config.PACK_PROXY
    done_base = 0
    with _http_client(proxy) as client:
        for f in spec.files:
            digest = _download_one(client, _mirror(f.url, mirror), staging / f.name,
                                   f.bytes, reporter, done_base, total)
            reporter.progress(phase="verifying", force=True)
            if digest != f.sha256:
                raise ValueError(f"checksum_mismatch:{f.name}")
            done_base += f.bytes
            reporter.progress(phase="downloading", done=done_base, total=total, force=True)

    reporter.progress(phase="installing", force=True)
    target = reg.pack_root(spec.id)
    target.mkdir(parents=True, exist_ok=True)
    for f in spec.files:
        os.replace(staging / f.name, target / f.name)
    try:
        staging.rmdir()
    except OSError:
        shutil.rmtree(staging, ignore_errors=True)
    reporter.progress(phase="finalizing", force=True)


def install(pack_id: str) -> int:
    """执行一次安装。返回进程退出码：0 成功，2 失败（错误已写进 .state.json）。"""
    specs = {s.id: s for s in reg.load_catalog()}
    spec = specs.get(pack_id)
    reporter = _Reporter(pack_id)
    if spec is None:
        reporter.state(status="failed", error="unknown_pack", pid=os.getpid())
        return 2

    reporter.progress(phase="resolving", force=True)
    reporter.state(status="installing", pack_version="1", pid=os.getpid(), error=None)

    if spec.depends_on is not None:
        dep = specs.get(spec.depends_on)
        if dep is None or reg.derive_status(dep) != "ready":
            reporter.progress(phase="resolving", error="dependency_not_ready", force=True)
            reporter.state(status="failed", error="dependency_not_ready", pid=None)
            return 2

    parent = reg.pack_root(pack_id)
    if not _disk_ok(parent, spec.bytes):
        reporter.progress(phase="resolving", error="insufficient_disk", force=True)
        reporter.state(status="failed", error="insufficient_disk", pid=None)
        return 2

    try:
        if spec.type == "runtime":
            _install_runtime(spec, reporter)
        else:
            _install_model(spec, reporter)
    except ValueError as exc:
        _cleanup_staging(pack_id)
        reason = str(exc)
        code = "checksum_mismatch" if reason.startswith("checksum_mismatch") else "install_error"
        reporter.progress(phase=reporter.phase, error=code, force=True)
        reporter.state(status="failed", error=code, pid=None)
        return 2
    except subprocess.CalledProcessError as exc:
        _cleanup_staging(pack_id)
        reporter.progress(phase=reporter.phase, error="dependency_install_failed", force=True)
        reporter.state(status="failed", error="dependency_install_failed", pid=None)
        _ = exc
        return 2
    except Exception as exc:  # noqa: BLE001 - 任何失败都要落成 failed，不能留 installing
        _cleanup_staging(pack_id)
        reporter.progress(phase=reporter.phase, error="network_error", force=True)
        reporter.state(status="failed", error="network_error", pid=None, detail=str(exc)[:500])
        return 2

    reporter.progress(phase="finalizing", done=spec.bytes, force=True)
    reporter.state(status="ready", installed_at=_now_iso(), pid=None,
                   verified_sha256=(spec.files[0].sha256 if spec.files else None), error=None)
    try:
        reg.progress_file(pack_id).unlink(missing_ok=True)
    except OSError:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="glaux-pack-installer")
    parser.add_argument("pack_id")
    args = parser.parse_args(argv)
    return install(args.pack_id)


if __name__ == "__main__":
    raise SystemExit(main())
