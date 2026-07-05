"""CUBS 数据集读取（U2）.

磁盘格式（2026-07-05 下载核对，见计划 U2）：

- 图像   ``IMAGES/<id>.tiff``（灰度）；主集 ``clin_XXXX_[L|R]``、技术集 ``tech_XXX``
- CF     ``CF/<id>_CF.txt`` = 单个浮点标量（mm/pixel）
- 边界   ``<seg_root>/<method>/<id>-{LI,MA}.txt`` = 两行空格分隔浮点（x 行 / y 行）
         method ∈ {Manual-A1, Manual-A1', Manual-A2, Manual-A3, Computerized-CNR_IT, …, GT-FAMUS}
- 中心   临床 CSV（分号分隔 + 逗号小数）首列（"Nicolaides - Cyprus" / Pisa）；无 IMT、无 CF 列

**IMT 必须从边界 + CF 算**（CSV 里没有现成 IMT 列）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from glaux_imt.errors import CalibrationUnavailable
from glaux_imt.io.boundaries import Boundary, BoundaryPair

# clin_0006_R / clin_0006_L / tech_383（技术集无侧）
_IMAGE_ID_RE = re.compile(r"^(?P<id>(?:clin|tech)_\d+)(?:_(?P<side>[LR]))?$")


@dataclass(frozen=True)
class CubsImageRecord:
    """一张 CUBS 图像的统一记录。"""

    image_id: str  # 含侧，唯一键，如 clin_0006_R
    subject: str  # 去侧的受试者/图像编号，如 clin_0006
    side: str | None  # "L" / "R" / None（技术集）
    image_path: Path
    cf: float | None  # mm/pixel；None 表示 CF 缺失（交由标定层决定降级/硬拒绝）
    center: str | None
    annotations: dict[str, BoundaryPair] = field(default_factory=dict)


def parse_image_id(stem: str) -> tuple[str, str | None]:
    """``clin_0006_R`` → (``clin_0006``, ``"R"``)；``tech_383`` → (``tech_383``, None)。"""
    m = _IMAGE_ID_RE.match(stem)
    if not m:
        raise ValueError(f"无法解析 CUBS 图像编号：{stem!r}")
    return m.group("id"), m.group("side")


def load_cf(cf_path: Path) -> float:
    """读取 ``CF/<id>_CF.txt`` 的单个 mm/pixel 标量。

    缺失或不可解析 → 抛 :class:`CalibrationUnavailable`（**不静默置 0**）。
    """
    if not cf_path.is_file():
        raise CalibrationUnavailable(f"CF 文件不存在：{cf_path}")
    raw = cf_path.read_text().strip()
    try:
        cf = float(raw)
    except ValueError as exc:
        raise CalibrationUnavailable(f"CF 不可解析（{cf_path}）：{raw!r}") from exc
    if not (cf > 0):
        raise CalibrationUnavailable(f"CF 非正（{cf_path}）：{cf}")
    return cf


def read_profile(txt_path: Path, name: str) -> Boundary:
    """读取一条边界的两行文本（第 1 行 x、第 2 行 y）为 :class:`Boundary`。"""
    lines = [ln for ln in txt_path.read_text().splitlines() if ln.strip()]
    if len(lines) != 2:
        raise ValueError(
            f"边界文件 {txt_path} 应为两行（x / y），实得 {len(lines)} 行"
        )
    x = np.fromstring(lines[0], sep=" ")
    y = np.fromstring(lines[1], sep=" ")
    return Boundary(name=name, x=x, y=y)


def load_centers(clinical_csv: Path) -> dict[str, str]:
    """从临床 CSV（分号分隔）建 ``subject → center`` 映射。

    首列是中心标签（如 "Nicolaides - Cyprus"），``Patient ID`` 列是受试者。
    只取"中心"这个粗粒度（Cyprus / Pisa），不解析其余临床变量。
    """
    text = clinical_csv.read_text(encoding="utf-8-sig")
    rows = [r for r in text.splitlines() if r.strip()]
    header = rows[0].split(";")
    try:
        pid_col = next(i for i, h in enumerate(header) if h.strip() == "Patient ID")
    except StopIteration as exc:
        raise ValueError(f"临床 CSV 缺 'Patient ID' 列：{clinical_csv}") from exc

    centers: dict[str, str] = {}
    for row in rows[1:]:
        cells = row.split(";")
        if len(cells) <= pid_col:
            continue
        label = cells[0].strip()
        center = _normalize_center(label)
        centers[cells[pid_col].strip()] = center
    return centers


def _normalize_center(label: str) -> str:
    low = label.lower()
    if "cyprus" in low:
        return "Cyprus"
    if "pisa" in low:
        return "Pisa"
    return label or "unknown"


def read_dataset(
    *,
    images_dir: Path,
    cf_dir: Path,
    segmentations_dir: Path,
    clinical_csv: Path | None = None,
    methods: list[str] | None = None,
) -> list[CubsImageRecord]:
    """装配 CUBS 记录列表。

    ``segmentations_dir`` 下每个 method 子目录含 ``<id>-LI.txt`` / ``<id>-MA.txt``；
    ``methods`` 缺省则自动发现所有子目录。CF 缺失记 ``cf=None``（不抛，留给标定层）；
    某 method 缺 LI 或 MA 则跳过该 method（记为缺席，不崩）。
    """
    images_dir, cf_dir = Path(images_dir), Path(cf_dir)
    segmentations_dir = Path(segmentations_dir)
    centers = load_centers(clinical_csv) if clinical_csv else {}

    if methods is None:
        methods = sorted(p.name for p in segmentations_dir.iterdir() if p.is_dir())

    records: list[CubsImageRecord] = []
    for image_path in sorted(images_dir.glob("*.tif*")):
        full_id = image_path.stem  # 含侧，文件命名的键，如 clin_0001_L
        subject, side = parse_image_id(full_id)  # 去侧受试者 + 侧
        try:
            cf: float | None = load_cf(cf_dir / f"{full_id}_CF.txt")
        except CalibrationUnavailable:
            cf = None

        annotations: dict[str, BoundaryPair] = {}
        for method in methods:
            li_path = segmentations_dir / method / f"{full_id}-LI.txt"
            ma_path = segmentations_dir / method / f"{full_id}-MA.txt"
            if not (li_path.is_file() and ma_path.is_file()):
                continue  # 该 method 对本图缺席
            annotations[method] = BoundaryPair(
                li=read_profile(li_path, "LI"),
                ma=read_profile(ma_path, "MA"),
            )

        records.append(
            CubsImageRecord(
                image_id=full_id,
                subject=subject,
                side=side,
                image_path=image_path,
                cf=cf,
                center=centers.get(subject),
                annotations=annotations,
            )
        )
    return records
