"""DataSource 注册表——数据表征层的运行时来源（替代 config 写死的固定根）。

见计划 docs/plans/2026-07-13-001-feat-datasource-registry-plan.md。

一条 :class:`DataSource` = 一个数据文件夹（+ 模态 + 标定提示 + 状态）。发现（``list_ids`` /
``/images`` / ``capabilities()``）改查这里，不再 glob config 固定根。

两种模式（用户要求保留开发者模式）：
- **开发者模式**（``GLAUX_DEV_MODE=1``，缺省）：内置源 = config 的 4 个 env 根的**实时视图**
  （:func:`_builtin_live`）——行为 == 现状；且因是实时读 ``config.X_ROOT``（非快照），
  测试对 config 根的 monkeypatch 立即反映。
- **产品模式**（``GLAUX_DEV_MODE=0``）：无内置源；用户经 :func:`register_folder` 导入文件夹后才有源。

导入源持久化到 ``sources.json``；内置源不落盘（每次实时从 config 读，避免落盘旧值盖回）。
护城河延伸：导入无标定的源标 ``needs_calibration``（跑任务时上层 422 硬拒绝，不出假值）。
纯 stdlib + config（无 science-core / 无重依赖）——可在主进程 import、可独立测。
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from . import config

# 与 schemas.Modality 同集合（此处用 str 避免 import schemas 引入 pydantic 到数据层）。
MODALITIES = ("carotid_imt", "fetal_hc", "ct_abdomen", "pathology")


@dataclass(frozen=True)
class DataSource:
    """一个已注册的数据源。``root`` 是数据文件夹；``calibration`` 是标定提示（见 §3.4）。"""

    id: str
    name: str
    modality: str
    root: Path
    origin: str  # builtin | imported | connector
    calibration: dict = field(default_factory=dict)
    status: str = "active"  # active | needs_calibration | empty | planned

    def to_dict(self) -> dict:
        d = asdict(self)
        d["root"] = str(self.root)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "DataSource":
        return cls(
            id=d["id"],
            name=d["name"],
            modality=d["modality"],
            root=Path(d["root"]),
            origin=d.get("origin", "imported"),
            calibration=dict(d.get("calibration", {})),
            status=d.get("status", "active"),
        )


# --- 环境开关 ---------------------------------------------------------------


def dev_mode() -> bool:
    """开发者模式（缺省 on）——是否提供内置源。产品部署置 ``GLAUX_DEV_MODE=0``。"""
    return os.environ.get("GLAUX_DEV_MODE", "1").strip().lower() not in ("0", "false", "no", "")


def datasets_root() -> Path:
    """导入源的允许根（白名单）——``register_folder`` 只接受此目录下的路径（防任意目录读）。"""
    v = os.environ.get("GLAUX_DATASETS_ROOT")
    return Path(v).expanduser() if v else (config.HOME / "glaux_datasets")


def sources_file() -> Path:
    """导入/连接器源的落盘清单（内置源实时从 config 读，不落盘）。"""
    v = os.environ.get("GLAUX_SOURCES_FILE")
    return Path(v).expanduser() if v else (datasets_root() / "sources.json")


# --- 内置源（开发者模式；config 根的实时视图，不快照）------------------------
# (id, 展示名, 模态, root, 标定提示)。root 实时读 config.X_ROOT——保证 == 现状 + monkeypatch 可覆盖。
def _builtin_specs() -> list[tuple]:
    return [
        ("cubs-tech", "CUBS-tech · carotid US", "carotid_imt",
         config.DATA_ROOT, {"cf": "per-image CF.txt"}),
        ("hc18", "HC18 · fetal head US", "fetal_hc",
         config.HC18_ROOT, {"pixel_size": "per-image csv"}),
        ("ct-demo", "CT abdomen · demo", "ct_abdomen",
         config.CT_ROOT, {"voxel_mm": "nifti header"}),
        ("wsi-demo", "WSI pathology · demo", "pathology",
         config.WSI_ROOT, {"mpp": "openslide props"}),
    ]


def _builtin_live() -> list[DataSource]:
    """内置源的实时视图——状态由 ``config.root_has_data``（**不**查注册表，避免递归）定。"""
    out: list[DataSource] = []
    for sid, name, modality, root, cal in _builtin_specs():
        root = Path(root)
        status = "active" if config.root_has_data(modality, root) else "empty"
        out.append(DataSource(
            id=sid, name=name, modality=modality, root=root,
            origin="builtin", calibration=dict(cal), status=status,
        ))
    return out


# --- 导入/连接器源（持久化；进程内单例，单后端进程假设，见计划 §5 并发注）----
_SOURCES: dict[str, DataSource] = {}


def _load_persisted() -> None:
    """回读落盘的导入/连接器源（不含 builtin）。文件缺失/损坏 → 忽略（起空）。"""
    fp = sources_file()
    if not fp.is_file():
        return
    try:
        raw = json.loads(fp.read_text())
    except (ValueError, OSError):
        return
    for d in raw.get("sources", []):
        try:
            src = DataSource.from_dict(d)
        except (KeyError, TypeError):
            continue
        if src.origin == "builtin":
            continue  # builtin 实时从 config 读，不认落盘的
        _SOURCES[src.id] = src


def _save_persisted() -> None:
    """把导入/连接器源写盘（原子：写临时文件再 rename）。"""
    fp = sources_file()
    fp.parent.mkdir(parents=True, exist_ok=True)
    payload = {"sources": [s.to_dict() for s in _SOURCES.values() if s.origin != "builtin"]}
    tmp = fp.with_suffix(fp.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp.replace(fp)


def init() -> None:
    """启动装配：回读落盘的导入源。内置源是实时视图无需 seed。幂等（测试/重启可重复调）。"""
    _SOURCES.clear()
    _load_persisted()


# --- 查询 -------------------------------------------------------------------


def list_all() -> list[DataSource]:
    """所有源（builtin 在前，稳定排序）——开发者模式含内置实时视图 + 落盘导入源。"""
    merged: dict[str, DataSource] = {}
    if dev_mode():
        for s in _builtin_live():
            merged[s.id] = s
    merged.update(_SOURCES)  # 导入源（id 与 builtin 不撞）
    return sorted(merged.values(), key=lambda s: (s.origin != "builtin", s.modality, s.id))


def sources_for(modality: str) -> list[DataSource]:
    """某模态的源（builtin 在前）。"""
    return [s for s in list_all() if s.modality == modality]


def resolve_root(modality: str) -> Path | None:
    """某模态当前生效的数据根——首个 active 源的 root（多源选择是后续，见计划 §5）。

    无 active 源 → None（上层据此走 mock 回退 / 503，与现状一致）。
    """
    for s in sources_for(modality):
        if s.status == "active":
            return s.root
    return None


# --- 导入 -------------------------------------------------------------------


class ImportError_(ValueError):
    """导入被拒（路径越界 / 不存在 / 模态非法）——上层映射 422。"""


def _safe_id(path: Path) -> str:
    """按解析后的绝对路径生成确定性 id——同文件夹重复导入 = 更新而非重复。"""
    h = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:8]
    return f"imported-{h}"


def register_folder(
    path: str | Path,
    modality: str,
    *,
    calibration: dict | None = None,
    name: str | None = None,
    detect: Callable[[Path, str], dict] | None = None,
) -> DataSource:
    """导入一个文件夹为数据源（落盘持久化）。

    - 路径必须存在、是目录、且在 :func:`datasets_root` 白名单下（防任意目录读）。
    - ``modality`` 须在 :data:`MODALITIES` 内。
    - 标定：显式 ``calibration`` 优先；否则用 ``detect(root, modality)`` 探测（U3 注入模态探针）；
      两者皆空 → ``status=needs_calibration``（上层跑任务时 422 硬拒绝）。
    - 空目录 → ``status=empty``。
    """
    if modality not in MODALITIES:
        raise ImportError_(f"非法模态：{modality}（须为 {MODALITIES}）")
    root = Path(path).expanduser()
    try:
        root = root.resolve()
    except OSError as e:
        raise ImportError_(f"路径无法解析：{path}（{e}）") from e
    if not root.is_dir():
        raise ImportError_(f"路径不存在或非目录：{root}")
    allow = datasets_root().resolve()
    if not root.is_relative_to(allow):
        raise ImportError_(f"路径越界：{root} 不在允许根 {allow} 下（防任意目录读）")

    cal = dict(calibration) if calibration else {}
    if not cal and detect is not None:
        try:
            cal = dict(detect(root, modality) or {})
        except Exception:  # noqa: BLE001 — 探测失败 → 视为无标定，标 needs_calibration
            cal = {}

    empty = not any(root.iterdir())
    if empty:
        status = "empty"
    elif cal:
        status = "active"
    else:
        status = "needs_calibration"

    src = DataSource(
        id=_safe_id(root),
        name=name or root.name,
        modality=modality,
        root=root,
        origin="imported",
        calibration=cal,
        status=status,
    )
    _SOURCES[src.id] = src
    _save_persisted()
    return src


def remove(source_id: str) -> bool:
    """删除一个导入/连接器源（builtin 不可删——它是 config 的实时视图）。返回是否删除。"""
    s = _SOURCES.get(source_id)
    if s is None:
        return False
    del _SOURCES[source_id]
    _save_persisted()
    return True
