"""可选模型组件的清单加载、状态推导与僵尸收敛（SDD 25 §7.1–§7.3、§9）。

状态真值以文件系统为准：``<pack>/.state.json`` 不存在即 ``absent``；``ready`` 还要求关键产物
齐全，二者不一致按 ``failed(incomplete)`` 处理，避免「装了但缺文件」被当成可用。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .. import config

STATE_FILE = ".state.json"
PROGRESS_FILE = ".progress.json"
HEARTBEAT_TIMEOUT_SECONDS = 60

PACK_TYPES = ("runtime", "model")
_ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class PacksCatalogError(RuntimeError):
    """清单不合法（缺字段、依赖不成立、URL 非 https 等）——启动即报，不静默降级。"""


@dataclass(frozen=True)
class PackFile:
    """一个需要下载的权重/配置文件。"""

    name: str
    url: str
    sha256: str
    bytes: int


@dataclass(frozen=True)
class PackSpec:
    """清单里的一项可选组件。"""

    id: str
    type: str
    depends_on: str | None
    display_name: str
    description: str
    license: str
    bytes: int
    files: tuple[PackFile, ...] = ()
    requirements: tuple[str, ...] = ()
    index_url: str | None = None


def catalog_path() -> Path:
    return config.PACKS_CATALOG


def pack_root(pack_id: str) -> Path:
    return config.PACKS_ROOT / pack_id


def state_file(pack_id: str) -> Path:
    return pack_root(pack_id) / STATE_FILE


def progress_file(pack_id: str) -> Path:
    return pack_root(pack_id) / PROGRESS_FILE


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise PacksCatalogError(msg)


def _parse_files(raw: Any, pack_id: str) -> tuple[PackFile, ...]:
    _require(isinstance(raw, list) and raw, f"pack {pack_id}: files 必须是非空数组")
    out: list[PackFile] = []
    for i, item in enumerate(raw):
        _require(isinstance(item, dict), f"pack {pack_id}: files[{i}] 必须是对象")
        name = item.get("name")
        url = item.get("url")
        sha = item.get("sha256")
        size = item.get("bytes")
        _require(isinstance(name, str) and name, f"pack {pack_id}: files[{i}].name 缺失")
        _require(
            "/" not in name and "\\" not in name,
            f"pack {pack_id}: files[{i}].name 不得含路径",
        )
        _require(
            isinstance(url, str) and url.startswith("https://"),
            f"pack {pack_id}: files[{i}] 仅允许 https",
        )
        _require(
            isinstance(sha, str) and _SHA256_RE.match(sha) is not None,
            f"pack {pack_id}: files[{i}].sha256 必须是 64 位十六进制",
        )
        _require(
            isinstance(size, int) and size > 0,
            f"pack {pack_id}: files[{i}].bytes 必须是正整数",
        )
        out.append(PackFile(name=name, url=url, sha256=sha, bytes=size))
    return tuple(out)


def _parse_one(raw: Any, seen: dict[str, PackSpec]) -> PackSpec:
    _require(isinstance(raw, dict), "packs 的每一项必须是对象")
    pack_id = raw.get("id")
    _require(
        isinstance(pack_id, str) and _ID_RE.match(pack_id) is not None,
        f"非法 pack id: {pack_id!r}",
    )
    _require(pack_id not in seen, f"重复的 pack id: {pack_id}")

    ptype = raw.get("type")
    _require(ptype in PACK_TYPES, f"pack {pack_id}: type 必须是 {'/'.join(PACK_TYPES)}")

    display = raw.get("display_name")
    _require(isinstance(display, str) and display, f"pack {pack_id}: display_name 缺失")
    desc = raw.get("description") or ""
    _require(isinstance(desc, str), f"pack {pack_id}: description 必须是字符串")
    lic = raw.get("license")
    _require(isinstance(lic, str) and lic, f"pack {pack_id}: license 缺失")
    size = raw.get("bytes")
    _require(isinstance(size, int) and size > 0, f"pack {pack_id}: bytes 必须是正整数")

    depends_on = raw.get("depends_on")
    files: tuple[PackFile, ...] = ()
    reqs: tuple[str, ...] = ()
    index_url = raw.get("index_url")

    if ptype == "model":
        _require(
            isinstance(depends_on, str) and depends_on,
            f"pack {pack_id}: model 必须声明 depends_on",
        )
        files = _parse_files(raw.get("files"), pack_id)
    else:
        _require(depends_on is None, f"pack {pack_id}: runtime 不应声明 depends_on")
        req_raw = raw.get("requirements")
        _require(
            isinstance(req_raw, list)
            and req_raw
            and all(isinstance(r, str) and r for r in req_raw),
            f"pack {pack_id}: runtime 必须声明非空 requirements",
        )
        reqs = tuple(req_raw)
        if index_url is not None:
            _require(
                isinstance(index_url, str) and index_url.startswith("https://"),
                f"pack {pack_id}: index_url 仅允许 https",
            )

    return PackSpec(
        id=pack_id,
        type=ptype,
        depends_on=depends_on,
        display_name=display,
        description=desc,
        license=lic,
        bytes=size,
        files=files,
        requirements=reqs,
        index_url=index_url,
    )


def load_catalog(path: Path | None = None) -> tuple[PackSpec, ...]:
    """读取并校验清单。任何不合法都抛 :class:`PacksCatalogError`。"""
    p = Path(path) if path is not None else catalog_path()
    if not p.is_file():
        raise PacksCatalogError(f"清单文件不存在：{p}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PacksCatalogError(f"清单不是合法 JSON：{p}（{exc}）") from exc
    _require(isinstance(data, dict), "清单顶层必须是对象")
    raw_packs = data.get("packs")
    _require(isinstance(raw_packs, list) and raw_packs, "清单 packs 必须是非空数组")

    specs: dict[str, PackSpec] = {}
    for raw in raw_packs:
        spec = _parse_one(raw, specs)
        specs[spec.id] = spec

    runtimes = {s.id for s in specs.values() if s.type == "runtime"}
    for spec in specs.values():
        if spec.type == "model":
            dep = spec.depends_on or ""
            _require(
                dep in runtimes,
                f"pack {spec.id}: depends_on 必须指向已声明的 runtime（当前 {dep}）",
            )
    return tuple(specs.values())


def read_state(pack_id: str) -> dict[str, Any] | None:
    p = state_file(pack_id)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def write_state(pack_id: str, state: dict[str, Any]) -> None:
    root = pack_root(pack_id)
    root.mkdir(parents=True, exist_ok=True)
    target = state_file(pack_id)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def read_progress(pack_id: str) -> dict[str, Any] | None:
    p = progress_file(pack_id)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _pid_alive(pid: Any) -> bool:
    """进程是否存活；无权限视为存活（存在但不是我们的）。"""
    try:
        n = int(pid)
    except (TypeError, ValueError):
        return False
    if n <= 0:
        return False
    try:
        os.kill(n, 0)
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _heartbeat_fresh(state: dict[str, Any]) -> bool:
    ts = _parse_iso(state.get("heartbeat_at"))
    if ts is None:
        return False
    return datetime.now(UTC) - ts < timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)


def key_artifacts_present(spec: PackSpec) -> bool:
    """关键产物是否齐全：runtime 看 venv 解释器，model 看每个申报文件。"""
    root = pack_root(spec.id)
    if spec.type == "runtime":
        return config.venv_python(root / ".venv").is_file()
    return all((root / f.name).is_file() for f in spec.files)


def derive_status(spec: PackSpec) -> str:
    """把文件系统事实折算成五态之一；僵尸 ``installing`` 就地收敛为 ``failed``。"""
    root = pack_root(spec.id)
    state = read_state(spec.id)
    if state is None:
        return "absent"

    status = state.get("status")
    if status == "ready":
        if key_artifacts_present(spec):
            return "ready"
        state["status"] = "failed"
        state["error"] = "incomplete"
        state["heartbeat_at"] = _now_iso()
        write_state(spec.id, state)
        return "failed"

    if status == "installing":
        if _pid_alive(state.get("pid")) or _heartbeat_fresh(state):
            return "installing"
        state["status"] = "failed"
        state["error"] = "interrupted"
        state["pid"] = None
        state["heartbeat_at"] = _now_iso()
        write_state(spec.id, state)
        return "failed"

    if status in ("failed", "uninstalling"):
        return status

    if not root.is_dir():
        return "absent"
    return "absent"


def is_ready(pack_id: str, specs: tuple[PackSpec, ...] | None = None) -> bool:
    """pack 是否可用于工具挂载。清单不合法或 id 未知一律 False。"""
    try:
        catalog = specs if specs is not None else load_catalog()
    except PacksCatalogError:
        return False
    for spec in catalog:
        if spec.id == pack_id:
            return derive_status(spec) == "ready"
    return False


def list_packs(specs: tuple[PackSpec, ...] | None = None) -> list[dict[str, Any]]:
    """对外契约形状（SDD 25 §9.4）。清单不合法时抛错，由路由转 500。"""
    catalog = specs if specs is not None else load_catalog()
    statuses = {s.id: derive_status(s) for s in catalog}
    out: list[dict[str, Any]] = []
    for spec in catalog:
        dep_ready = True if spec.depends_on is None else statuses.get(spec.depends_on) == "ready"
        state = read_state(spec.id) or {}
        out.append(
            {
                "id": spec.id,
                "type": spec.type,
                "depends_on": spec.depends_on,
                "display_name": spec.display_name,
                "description": spec.description,
                "license": spec.license,
                "bytes": spec.bytes,
                "status": statuses[spec.id],
                "dependency_ready": dep_ready,
                "error": state.get("error"),
            }
        )
    return out
