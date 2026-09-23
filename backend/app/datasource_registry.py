"""DataSource 注册表——观测空间的数据来源（替代 config 写死的固定根）。

见计划 docs/plans/2026-07-13-001-feat-datasource-registry-plan.md。

一条 :class:`DataSource` = 一个数据文件夹（+ 模态 + 标定提示 + 状态）。发现（``list_ids`` /
``/images`` / ``capabilities()``）改查这里，不再 glob config 固定根。

模态由 :data:`app.sources.SOURCES`（SDD 10 §8.2）决定：``MODALITIES = tuple(SOURCES)``；内置源由各
``Source.builtin_sample()`` 提供，开发者模式下另有 ``Source.synthetic_sample()`` 显式注册的合成源
（``synthetic-us`` / ``synthetic-hc``，D-17）。对象 id 的唯一解析入口是 :func:`resolve_object`。

两种模式（用户要求保留开发者模式）：
- **开发者模式**（``GLAUX_DEV_MODE=1``；开发脚本显式设置）：内置源 = config 的 4 个
  env 根的**实时视图**
  （:func:`_builtin_live`）——行为 == 现状；且因是实时读 ``config.X_ROOT``（非快照），
  测试对 config 根的 monkeypatch 立即反映。
- **产品模式**（``GLAUX_DEV_MODE=0``，缺省）：无内置源；
  用户经 :func:`register_folder` 导入文件夹后才有源。

导入源持久化到 ``sources.json``；内置源不落盘（每次实时从 config 读，避免落盘旧值盖回）。
护城河延伸：导入无标定的源标 ``needs_calibration``（跑任务时上层 422 硬拒绝，不出假值）。
模块导入期仍是纯 stdlib + config；``SOURCES`` 在函数内惰性导入（它会导入各数据模块）。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from . import config

if TYPE_CHECKING:  # pragma: no cover
    from .sources.base import ObjectRef, Source

log = logging.getLogger("glaux.datasources")


def _sources() -> dict[str, Source]:
    from .sources import SOURCES

    return SOURCES


def default_capabilities(modality: str) -> list[str]:
    """无 TaskPlugin 模态的能力位默认集（SDD 10 §9.4）；该模态有 TaskPlugin 时为空。

    判定点只在这里：有任务行即整体以 ``TaskPlugin.capabilities``（经 ``GET /tasks``）为准，
    否则整体取 ``Source.kind`` 的默认集，两者永不合并。
    """
    from .sources.base import DEFAULT_CAPABILITIES

    try:
        from glaux_core.tasks import REGISTRY
    except Exception:  # noqa: BLE001 - science-core 不可用时视为无任务行
        REGISTRY = {}
    if any(p.modality == modality for p in REGISTRY.values()):
        return []
    return list(DEFAULT_CAPABILITIES.get(_sources()[modality].kind, ()))


def modalities() -> tuple[str, ...]:
    """已注册模态，顺序即 ``SOURCES`` 的登记顺序。"""
    return tuple(_sources())


def __getattr__(name: str):
    # MODALITIES = tuple(SOURCES)：惰性求值，保持本模块导入期不碰数据模块。
    if name == "MODALITIES":
        return modalities()
    raise AttributeError(name)


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
    #: 开发者模式下的合成源（无真实目录，不参与 resolve_root，不落盘）。
    synthetic: bool = False
    #: 内置示例的出处、许可与描述（能力清单数据集卡用）；导入源为空。不落盘。
    provider: str = ""
    license: str = ""
    desc: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["root"] = str(self.root)
        for k in ("synthetic", "provider", "license", "desc"):
            d.pop(k)
        return d

    def info(self) -> dict:
        """``DataSourceInfo`` 形状：落盘字段 + 由 ``SOURCES[modality]`` 派生的四个展示字段。"""
        src = _sources()[self.modality]
        return {
            **self.to_dict(),
            "kind": src.kind,
            "label": src.label,
            "label_key": src.label_key,
            "importable": [ext for ext, _magic, _offset in src.formats],
            "default_capabilities": default_capabilities(self.modality),
        }

    @classmethod
    def from_dict(cls, d: dict) -> DataSource:
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
    """开发者模式——是否自动提供全部内置源。

    **缺省 off（SDD 08 D-4）**：新用户第一屏该是「把你的数据放进来」，而不是四个演示数据集；
    示例改由「加载示例数据」显式打开（:func:`register_builtin_samples`）。
    开发环境在启动脚本里显式置 ``GLAUX_DEV_MODE=1`` 回到旧行为。
    """
    return os.environ.get("GLAUX_DEV_MODE", "0").strip().lower() not in ("0", "false", "no", "")


def datasets_root() -> Path:
    """导入源的允许根（白名单）——``register_folder`` 只接受此目录下的路径（防任意目录读）。"""
    v = os.environ.get("GLAUX_DATASETS_ROOT")
    return Path(v).expanduser() if v else (config.HOME / "glaux_datasets")


def sources_file() -> Path:
    """导入/连接器源的落盘清单（内置源实时从 config 读，不落盘）。"""
    v = os.environ.get("GLAUX_SOURCES_FILE")
    return Path(v).expanduser() if v else (datasets_root() / "sources.json")


# --- 内置源（开发者模式；config 根的实时视图，不快照）------------------------
# 由各 Source.builtin_sample() 提供；root 实时读 config.X_ROOT——保证 == 现状 + monkeypatch 可覆盖。


def _builtin_live() -> list[DataSource]:
    """内置源的实时视图——状态由 ``Source.probe``（**不**查注册表，避免递归）定。"""
    out: list[DataSource] = []
    for src in _sources().values():
        spec = src.builtin_sample()
        if spec is None:
            continue
        status = "active" if src.probe(Path(spec.root)) else "empty"
        out.append(DataSource(**{**asdict(spec), "root": Path(spec.root), "status": status}))
    return out


def _builtin_ids() -> set[str]:
    return {s.id for s in (src.builtin_sample() for src in _sources().values()) if s is not None}


def _synthetic_live() -> list[DataSource]:
    """开发者模式的合成源（D-17）。状态由调用方按「同模态有无其他 active 源」定。"""
    out: list[DataSource] = []
    for src in _sources().values():
        spec = src.synthetic_sample()
        if spec is not None:
            out.append(DataSource(**{**asdict(spec), "synthetic": True}))
    return out


# --- 导入/连接器源（持久化；进程内单例，单后端进程假设，见计划 §5 并发注）----
_SOURCES: dict[str, DataSource] = {}
#: 用户显式「加载示例数据」打开的内置源 id（SDD 08 §5.2）。只存 id，源本体仍是 config 实时视图。
_SAMPLES_ON: set[str] = set()


def _load_persisted() -> None:
    """回读落盘的导入/连接器源与已打开的示例 id。文件缺失/损坏 → 忽略（起空）。"""
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
    # 旧文件没有 "samples" 键 → 空集合，行为与改前一致（只增不改，老清单照常回读）
    known = _builtin_ids()
    for sid in raw.get("samples", []):
        if isinstance(sid, str) and sid in known:
            _SAMPLES_ON.add(sid)


def _save_persisted() -> None:
    """把导入/连接器源与已打开的示例 id 写盘（原子：写临时文件再 rename）。"""
    fp = sources_file()
    fp.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "sources": [s.to_dict() for s in _SOURCES.values() if s.origin != "builtin"],
        "samples": sorted(_SAMPLES_ON),
    }
    tmp = fp.with_suffix(fp.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp.replace(fp)


def init() -> None:
    """启动装配：回读落盘的导入源与示例开关。

    内置源是实时视图无需 seed。幂等（测试/重启可重复调）。
    """
    _SOURCES.clear()
    _SAMPLES_ON.clear()
    _load_persisted()
    invalidate_index()


# --- 查询 -------------------------------------------------------------------


def list_all() -> list[DataSource]:
    """所有源（builtin 在前，稳定排序）。

    内置源的可见性有两条路：开发者模式（全部实时可见，== 改前行为），或用户显式「加载示例数据」
    打开过的那些（``_SAMPLES_ON``）。两条都不满足 → 产品模式的空清单，文件栏据此渲染空态。

    合成源只在开发者模式出现，且仅当同模态没有其他 active 源时为 active：合成 id 与真实 id
    同形（``tech_4xx``），两者同时 active 会让同一 id 指向两个对象（§10 resolve_object 恒等）。
    模态不在 ``SOURCES`` 中的导入源（如对应数据模块缺依赖）保留在落盘清单里，但不列出。
    """
    registered = _sources()
    merged: dict[str, DataSource] = {}
    for s in _builtin_live():
        if dev_mode() or s.id in _SAMPLES_ON:
            merged[s.id] = s
    merged.update(_SOURCES)  # 导入源（id 与 builtin 不撞）
    if dev_mode():
        real_active = {s.modality for s in merged.values() if s.status == "active"}
        for s in _synthetic_live():
            status = "empty" if s.modality in real_active else "active"
            merged[s.id] = DataSource(**{**asdict(s), "status": status})
    listed = [s for s in merged.values() if s.modality in registered]
    return sorted(listed, key=lambda s: (s.origin != "builtin", s.modality, s.id))


def sources_for(modality: str) -> list[DataSource]:
    """某模态的源（builtin 在前）。"""
    return [s for s in list_all() if s.modality == modality]


def active_sources(modality: str) -> list[DataSource]:
    """某模态当前 active 的源（含合成源），顺序同 :func:`list_all`。"""
    return [s for s in sources_for(modality) if s.status == "active"]


def resolve_root(modality: str) -> Path | None:
    """某模态当前生效的数据根——首个 active 的真实源的 root（多源选择是后续，见计划 §5）。

    合成源没有目录，不参与。无 active 源 → None。
    """
    for s in active_sources(modality):
        if not s.synthetic:
            return s.root
    return None


# --- 对象 id 解析（SDD 10 §6.5）--------------------------------------------------

_index: dict[str, ObjectRef] | None = None
_index_lock = threading.Lock()


def invalidate_index() -> None:
    """作废 id → ObjectRef 索引；下次解析时重建（SDD 10 §11.2）。"""
    global _index
    with _index_lock:
        _index = None


def _build_index() -> dict[str, ObjectRef]:
    from .sources.base import ObjectRef

    out: dict[str, ObjectRef] = {}
    for modality, src in _sources().items():
        for ds in active_sources(modality):
            try:
                ids = src.list_ids(ds)
            except Exception as exc:  # noqa: BLE001 - 单源读失败不拖垮整张索引
                log.warning("数据源 %s 列举失败，未进入索引：%s", ds.id, exc)
                continue
            for oid in ids:
                # 同 id 多源时首个胜出，与 resolve_root 的「首个 active 源」一致
                out.setdefault(oid, ObjectRef(src, ds, oid, src.kind, modality))
    return out


def resolve_object(object_id: str) -> ObjectRef:
    """唯一 id 解析入口：先查索引，未命中再遍历 ``Source.is_mine`` 兜底。

    两级都未命中 → :class:`LookupError`（路由层转 404），不回落到任何合成源（D-17）。
    """
    from .sources.base import ObjectRef

    global _index
    with _index_lock:
        if _index is None:
            _index = _build_index()
        hit = _index.get(object_id)
    if hit is not None:
        return hit
    for modality, src in _sources().items():
        if not src.is_mine(object_id):
            continue
        ds = src.locate(object_id)
        if ds is None:
            continue
        ref = ObjectRef(src, ds, object_id, src.kind, modality)
        log.info("resolve_object 兜底命中：%s → %s", object_id, ds.id)
        with _index_lock:
            if _index is not None:
                _index[object_id] = ref
        return ref
    raise LookupError(f"对象不存在：{object_id}")


# --- 导入 -------------------------------------------------------------------


def _invalidate_dataset_caches() -> None:
    """源清单变了 → 各 Source 的缓存与 id 索引一并失效（技术债 D5、SDD 10 §11.2）。

    写成一个函数而不是在三处各写一遍，是因为第四个变更入口迟早会加进来，那时漏掉一处就又是
    一条静默的陈旧缓存。单个 Source 失效失败只记日志，不让一次数据源增删失败。
    """
    for src in _sources().values():
        try:
            src.invalidate()
        except Exception as exc:  # noqa: BLE001
            log.warning("%s 缓存失效失败：%s", src.modality, exc)
    invalidate_index()


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
    - ``modality`` 须是 ``SOURCES`` 的键。
    - 标定：显式 ``calibration`` 优先；否则用 ``detect(root, modality)`` 探测（U3 注入模态探针）；
      两者皆空且该 Source 要求标定 → ``status=needs_calibration``（上层跑任务时 422 硬拒绝）。
    - 空目录 → ``status=empty``。
    """
    registered = _sources()
    if modality not in registered:
        raise ImportError_(f"非法模态：{modality}（须为 {tuple(registered)}）")
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
    elif cal or not registered[modality].calibration_required:
        # 通用图像没有标定这回事（无 TaskPlugin、不出带单位结果），空 calibration 是常态而非缺失；
        # 若也标 needs_calibration，上层会对一张普通照片 422，那是把医学护栏套到了非医学对象上。
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
    _invalidate_dataset_caches()
    return src


def register_builtin_samples() -> list[DataSource]:
    """把内置示例根中**确实有数据**的那些显式打开（SDD 08 §5.2 / §7 规则 11）。

    与开发者模式的实时视图区别只在「显式」：产品模式下默认没有内置源，用户点「加载示例数据」才有。
    落盘的是 **id 集合**而非源快照——示例的 root 仍每次从 config 实时读，避免落盘旧路径盖回新配置
    （与 builtin 一贯的实时视图立场一致）。

    幂等：重复调用不新增条目（§10）。空目录不注册也不报错——没有示例是正常状态，不是错误状态。
    """
    live = {s.id: s for s in _builtin_live() if s.status == "active"}
    if not live:
        return []
    _SAMPLES_ON.update(live)
    _save_persisted()
    _invalidate_dataset_caches()
    return [live[sid] for sid in sorted(live)]


def remove(source_id: str) -> bool:
    """删除一个导入/连接器源（builtin 不可删——它是 config 的实时视图）。返回是否删除。"""
    s = _SOURCES.get(source_id)
    if s is None:
        return False
    del _SOURCES[source_id]
    _save_persisted()
    _invalidate_dataset_caches()
    return True
