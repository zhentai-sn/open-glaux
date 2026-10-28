"""可选模型组件端点（SDD 25 §7.6）。

五个端点全部走回环守卫：管理端点能改动本机磁盘与网络出口，与 ``/fs``、``/projects`` 同级。
安装由独立子进程执行（:mod:`app.packs.installer`），本模块只做排队、spawn 与读状态。
"""

from __future__ import annotations

import json
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import config
from ..packs import installer as installer_mod
from ..packs import registry as reg
from .loopback import require_loopback

router = APIRouter(
    prefix="/packs",
    tags=["packs"],
    dependencies=[Depends(require_loopback)],
)


class _Runner:
    """全局串行安装器：同一时刻只允许一个子进程（SDD 25 §7.10）。"""

    def __init__(self) -> None:
        self._q: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[bytes] | None = None
        self._current: str | None = None
        self._queued: list[str] = []
        self._thread: threading.Thread | None = None

    def _backend_dir(self) -> Path:
        return Path(config.REPO_ROOT) / "backend"

    def ensure_worker(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            t = threading.Thread(target=self._loop, name="glaux-pack-runner", daemon=True)
            self._thread = t
            t.start()

    def _loop(self) -> None:
        while True:
            pack_id = self._q.get()
            with self._lock:
                self._queued = [p for p in self._queued if p != pack_id]
                self._current = pack_id
            try:
                proc = subprocess.Popen(
                    [sys.executable, "-m", "app.packs.installer", pack_id],
                    cwd=str(self._backend_dir()),
                )
                with self._lock:
                    self._proc = proc
                proc.wait()
            except Exception:  # noqa: BLE001 - spawn 失败也要让状态可读
                state = reg.read_state(pack_id) or {}
                state["status"] = "failed"
                state["error"] = "spawn_failed"
                state["pid"] = None
                reg.write_state(pack_id, state)
            finally:
                with self._lock:
                    self._proc = None
                    self._current = None

    def submit(self, pack_id: str) -> str:
        """返回 ``started`` / ``queued`` / ``running``。"""
        self.ensure_worker()
        with self._lock:
            if self._current == pack_id:
                return "running"
            if pack_id in self._queued:
                return "queued"
            self._queued.append(pack_id)
        self._q.put(pack_id)
        return "started" if len(self._queued) == 1 else "queued"

    def cancel(self, pack_id: str) -> bool:
        with self._lock:
            proc = self._proc
            current = self._current
        if current == pack_id and proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            return True
        with self._lock:
            if pack_id in self._queued:
                self._queued = [p for p in self._queued if p != pack_id]
                return True
        return False

    def queue_position(self, pack_id: str) -> int | None:
        with self._lock:
            if pack_id in self._queued:
                return self._queued.index(pack_id) + 1
        return None


RUNNER = _Runner()

# 各模型组件的推理入口：脚本名 + 需要就位的权重文件（按通用性可继续加）
INFER_SCRIPTS: dict[str, str] = {"depth-dav2s": "infer_depth.py"}
INFER_TIMEOUT_SECONDS = 120


def _specs() -> dict[str, reg.PackSpec]:
    try:
        return {s.id: s for s in reg.load_catalog()}
    except reg.PacksCatalogError as exc:
        raise HTTPException(500, f"组件清单不可用：{exc}") from exc


def _require_spec(pack_id: str) -> reg.PackSpec:
    spec = _specs().get(pack_id)
    if spec is None:
        raise HTTPException(404, f"未知的组件：{pack_id}")
    return spec


@router.get("")
def list_packs() -> dict[str, Any]:
    return {"packs": reg.list_packs(tuple(_specs().values()))}


@router.get("/{pack_id}/progress")
def pack_progress(pack_id: str) -> dict[str, Any]:
    spec = _require_spec(pack_id)
    status = reg.derive_status(spec)
    progress = reg.read_progress(pack_id) or {}
    state = reg.read_state(pack_id) or {}
    return {
        "id": pack_id,
        "status": status,
        "phase": progress.get("phase"),
        "bytes_done": progress.get("bytes_done", 0),
        "bytes_total": progress.get("bytes_total", spec.bytes),
        "updated_at": progress.get("updated_at"),
        "error": state.get("error") or progress.get("error"),
        "queue_position": RUNNER.queue_position(pack_id),
    }


@router.post("/{pack_id}/install")
def install_pack(pack_id: str) -> dict[str, Any]:
    spec = _require_spec(pack_id)
    status = reg.derive_status(spec)

    if status == "ready":
        return {"id": pack_id, "accepted": True, "started": False, "status": "ready"}
    if status == "installing":
        return {"id": pack_id, "accepted": True, "started": False, "status": "installing"}

    if status == "failed":
        # 重试即清理旧痕迹（SDD 25 §10 规则 3）
        _cleanup(pack_id)
    elif status == "uninstalling":
        raise HTTPException(409, "该组件正在卸载，稍后重试")

    if spec.depends_on is not None:
        dep = _require_spec(spec.depends_on)
        if reg.derive_status(dep) != "ready":
            RUNNER.submit(spec.depends_on)

    action = RUNNER.submit(pack_id)
    return {
        "id": pack_id,
        "accepted": True,
        "started": action == "started",
        "status": "installing",
        "queue_position": RUNNER.queue_position(pack_id),
    }


@router.post("/{pack_id}/cancel")
def cancel_pack(pack_id: str) -> dict[str, Any]:
    spec = _require_spec(pack_id)
    _ = spec
    cancelled = RUNNER.cancel(pack_id)
    if cancelled:
        _cleanup(pack_id)
        return {"id": pack_id, "cancelled": True, "status": "absent"}
    return {"id": pack_id, "cancelled": False, "status": reg.derive_status(spec)}


@router.delete("/{pack_id}")
def uninstall_pack(pack_id: str) -> dict[str, Any]:
    spec = _require_spec(pack_id)
    status = reg.derive_status(spec)

    dependents = [
        s.id
        for s in _specs().values()
        if s.depends_on == pack_id and reg.derive_status(s) == "ready"
    ]
    if dependents:
        raise HTTPException(
            409,
            {
                "code": "pack_in_use",
                "message": f"该组件仍被 {', '.join(dependents)} 依赖，请先卸载依赖方",
                "dependents": dependents,
            },
        )

    if status == "installing":
        RUNNER.cancel(pack_id)

    _cleanup(pack_id)
    return {"id": pack_id, "status": "absent", "previous_status": status}


def _cleanup(pack_id: str) -> None:
    """删除 pack 目录、临时目录、进度与状态文件。"""
    root = reg.pack_root(pack_id)
    staging = root.with_name(pack_id + installer_mod.TMP_SUFFIX)
    for path in (staging, root):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    for leftover in (reg.state_file(pack_id), reg.progress_file(pack_id)):
        try:
            leftover.unlink(missing_ok=True)
        except OSError:
            pass
    time.sleep(0)


@router.post("/{pack_id}/infer")
async def infer_pack(pack_id: str, request: Request) -> dict[str, Any]:
    """用已安装的模型组件做一次推理（SDD 25 §7.1 的模型能力出口）。

    请求体为图片原始字节；推理在 vision-runtime 的隔离子进程中完成，主进程不 import onnxruntime。
    """
    spec = _require_spec(pack_id)
    script = INFER_SCRIPTS.get(pack_id)
    if script is None:
        raise HTTPException(400, f"组件 {pack_id} 未注册推理入口")
    if spec.type != "model" or spec.depends_on is None:
        raise HTTPException(400, "只有带运行时依赖的模型组件支持推理")
    if reg.derive_status(spec) != "ready":
        raise HTTPException(409, "组件尚未安装")
    dep_id = spec.depends_on
    dep = _require_spec(dep_id)
    if reg.derive_status(dep) != "ready":
        raise HTTPException(409, "运行时组件尚未就绪")

    body = await request.body()
    if not body:
        raise HTTPException(400, "请求体为空")

    runtime_py = config.venv_python(reg.pack_root(dep_id) / ".venv")
    if not runtime_py.is_file():
        raise HTTPException(409, "运行时解释器缺失")
    model_dir = reg.pack_root(pack_id)
    args = [str(model_dir / f.name) for f in spec.files]
    if len(args) < 2:
        raise HTTPException(500, "组件清单缺少权重或配置")

    with tempfile.TemporaryDirectory(prefix="glaux-infer-") as tmp:
        image_path = Path(tmp) / "input.png"
        out_path = Path(tmp) / "out.json"
        image_path.write_bytes(body)
        cmd = [str(runtime_py), str(Path(__file__).resolve().parents[1] / "packs" / script),
               str(image_path), args[0], args[1], str(out_path)]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=INFER_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "推理超时") from exc
        if proc.returncode != 0 or not out_path.is_file():
            detail = (proc.stderr or b"").decode("utf-8", "replace")[-800:]
            raise HTTPException(500, f"推理失败：{detail or proc.returncode}")
        return json.loads(out_path.read_text(encoding="utf-8"))
