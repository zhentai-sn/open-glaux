"""M1 真实接入配置——路径、science-core/orchestration 装配、可用性判定。

一切路径可用环境变量覆盖；缺省指向本机 2026-07-06 下载/验证的真实资产：
- CUBS-tech 数据集：``~/glaux_datasets/cubs_data/tech_extract/DATASET_CUBS_tech``
- caroSegDeep 隔离环境：``~/glaux_models/caroSegDeep/.venv-csd`` + ``run_headless.py``
- caroSegDeep 真实产出缓存（eval 100 图 tech_401–500）：``~/glaux_models/csd_out``

数据不可用时端点回退 mock（见 mock.py），使外壳/CI 无数据也能起。
主进程只 import science-core / orchestration（纯 numpy/PIL），**绝不引入 TF**——
TF 隔离在 caroSegDeep 的 .venv-csd 子进程（见 segment_proc.py）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _env_path(key: str, default: Path) -> Path:
    v = os.environ.get(key)
    return Path(v).expanduser() if v else default


HOME = Path.home()
REPO_ROOT = Path(__file__).resolve().parents[2]  # backend/app/config.py → repo/

# --- 源码装配：把 science-core / orchestration 挂上 sys.path（不改其打包） -----
_SCIENCE_CORE = _env_path("GLAUX_SCIENCE_CORE", REPO_ROOT / "science-core")
_ORCHESTRATION = _env_path("GLAUX_ORCHESTRATION", REPO_ROOT / "orchestration")
for _p in (_SCIENCE_CORE, _ORCHESTRATION):
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

# --- 数据集路径（CUBS-tech） -------------------------------------------------
DATA_ROOT = _env_path("GLAUX_DATA_ROOT", HOME / "glaux_datasets/cubs_data/tech_extract/DATASET_CUBS_tech")
IMAGES_DIR = DATA_ROOT / "images"
CF_DIR = DATA_ROOT / "CF"
SEG_DIR = DATA_ROOT / "LIMA-Profiles"

# 演示队列：GT-FAMUS + caroSegDeep 全覆盖的 100 图（eval 验证过的 tech_401–500）。
DEMO_ID_LO = int(os.environ.get("GLAUX_DEMO_LO", "401"))
DEMO_ID_HI = int(os.environ.get("GLAUX_DEMO_HI", "500"))

# --- caroSegDeep 隔离环境 ----------------------------------------------------
CSD_ROOT = _env_path("GLAUX_CSD_ROOT", HOME / "glaux_models/caroSegDeep")
CSD_PYTHON = _env_path("GLAUX_CSD_PYTHON", CSD_ROOT / ".venv-csd/bin/python")
CSD_DRIVER = _env_path("GLAUX_CSD_DRIVER", CSD_ROOT / "SEGMENTATION/run_headless.py")
CSD_WEIGHTS = _env_path("GLAUX_CSD_WEIGHTS", CSD_ROOT / "EXAMPLE/TRAINED_MODEL")
# caroSegDeep 真实产出缓存（eval 100 图）+ 本会话新算结果落盘目录。
CSD_CACHE = _env_path("GLAUX_CSD_CACHE", HOME / "glaux_models/csd_out")

# --- HC 第二模态：HC18 真实数据集（Zenodo 1327317，CC-BY-4.0） ----------------
HC18_ROOT = _env_path("GLAUX_HC18_ROOT", HOME / "glaux_datasets/hc18_data")

# --- HC 分割隔离环境（CSM，HuggingFace gauravxthakur/Fetal-Head-Biometry，Apache-2.0）
HC_SEG_ROOT = _env_path("GLAUX_HC_SEG_ROOT", HOME / "glaux_models/hc_seg")
HC_SEG_PYTHON = _env_path("GLAUX_HC_SEG_PYTHON", HC_SEG_ROOT / ".venv-hc/bin/python")
HC_SEG_DRIVER = _env_path("GLAUX_HC_SEG_DRIVER", HC_SEG_ROOT / "run_headless.py")
HC_SEG_WEIGHTS = _env_path("GLAUX_HC_SEG_WEIGHTS", HC_SEG_ROOT / "hf/test_model.pth")
HC_SEG_CACHE = _env_path("GLAUX_HC_SEG_CACHE", HOME / "glaux_models/hc_seg_out")

# --- P6 第三模态：CT 体积数据 + TotalSegmentator 隔离环境（v2.4.0，Apache-2.0）---
CT_ROOT = _env_path("GLAUX_CT_ROOT", REPO_ROOT / "data/ct")
# 隔离环境（主进程绝不 import torch；与 .venv-csd / .venv-hc 同构）
TS_ROOT = _env_path("GLAUX_TS_ROOT", HOME / "glaux_models/totalseg")
TS_PYTHON = _env_path("GLAUX_TS_PYTHON", TS_ROOT / ".venv-ts/bin/python")
TS_DRIVER = _env_path("GLAUX_TS_DRIVER", TS_ROOT / "run_headless.py")
TS_WEIGHTS = _env_path("GLAUX_TS_WEIGHTS", TS_ROOT / "weights")
TS_CACHE = _env_path("GLAUX_TS_CACHE", HOME / "glaux_models/ts_out")

# --- P7 第四模态：病理 WSI 数据 + 核分割隔离环境（StarDist-HE / HoVerNet-PanNuke）------
# OpenSlide 读 .svs/.ndpi 在主进程（数据 IO C 库，同 nibabel）；瓦片落盘缓存。
WSI_ROOT = _env_path("GLAUX_WSI_ROOT", REPO_ROOT / "data/wsi")
WSI_CACHE = _env_path("GLAUX_WSI_CACHE", HOME / "glaux_models/wsi_tiles")
# 核分割隔离环境（主进程绝不 import torch/TF；与 .venv-ts 同构）
WSI_SEG_ROOT = _env_path("GLAUX_WSI_SEG_ROOT", HOME / "glaux_models/wsi_seg")
WSI_SEG_PYTHON = _env_path("GLAUX_WSI_SEG_PYTHON", WSI_SEG_ROOT / ".venv-wsi/bin/python")
WSI_SEG_DRIVER = _env_path("GLAUX_WSI_SEG_DRIVER", WSI_SEG_ROOT / "run_headless.py")
WSI_SEG_WEIGHTS = _env_path("GLAUX_WSI_SEG_WEIGHTS", WSI_SEG_ROOT / "weights")
WSI_SEG_CACHE = _env_path("GLAUX_WSI_SEG_CACHE", HOME / "glaux_models/wsi_seg_out")

# WSI vendor 格式后缀（OpenSlide 支持面的子集；v0 走 .svs demo）。
_WSI_SUFFIXES = (".svs", ".ndpi", ".tif", ".tiff", ".mrxs", ".scn", ".vms", ".bif")


def root_has_data(modality: str, root: Path) -> bool:
    """某模态在给定 ``root`` 下是否有数据——内置源探针 + 可用性判定共用。

    **不查注册表**（直接判目录），故可安全用作 ``seed_builtin`` 的探针，不会与
    :func:`datasource_registry.resolve_root` 递归。各模态的「有数据」判据即原
    ``*_available`` 的目录检查，只是把 root 参数化。
    """
    if modality == "carotid_imt":
        return (root / "images").is_dir() and (root / "CF").is_dir() and (root / "LIMA-Profiles").is_dir()
    if modality == "fetal_hc":
        return (root / "training_set/training_set").is_dir() and (
            root / "training_set_pixel_size_and_HC.csv"
        ).is_file()
    if modality == "ct_abdomen":
        # 注：Path("ct_001.nii.gz").suffix == ".gz"（非 ".nii.gz"），用 name.endswith 判复合后缀。
        return root.is_dir() and any(
            p.name.endswith((".nii", ".nii.gz")) for p in root.glob("ct_*")
        )
    if modality == "pathology":
        return root.is_dir() and any(
            p.suffix.lower() in _WSI_SUFFIXES for p in root.glob("slide_*")
        )
    return False


def _available(modality: str) -> bool:
    """某模态数据是否就绪——注册表感知：当前生效源（resolve_root）下有数据即就绪。

    开发者模式下 resolve_root 返回内置源 root（== 本文件的 X_ROOT 默认），行为与改前一致；
    产品模式无源 → None → False（端点回退 mock / 503）。
    """
    from . import datasource_registry as reg  # 延迟导入，避免模块级循环

    root = reg.resolve_root(modality)
    return root is not None and root_has_data(modality, root)


def data_available() -> bool:
    """真实数据集是否就绪（否则端点回退 mock）。"""
    return _available("carotid_imt")


def csd_live_available() -> bool:
    """caroSegDeep 隔离环境是否可现算（缓存未命中时才需要）。"""
    return CSD_PYTHON.is_file() and CSD_DRIVER.is_file() and CSD_WEIGHTS.is_dir()


def hc_data_available() -> bool:
    """HC18 真实数据集是否就绪（否则 HC 端点回退自包含合成数据）。"""
    return _available("fetal_hc")


def hc_live_available() -> bool:
    """HC 分割隔离环境是否可现算（缓存未命中时才需要）。"""
    return HC_SEG_PYTHON.is_file() and HC_SEG_DRIVER.is_file() and HC_SEG_WEIGHTS.is_file()


def ct_data_available() -> bool:
    """CT 体积数据是否就绪（当前生效源下 ship 了至少 1 例 NIfTI）。"""
    return _available("ct_abdomen")


def ts_live_available() -> bool:
    """TotalSegmentator 隔离环境是否可现算（缓存未命中时才需要）。"""
    return TS_PYTHON.is_file() and TS_DRIVER.is_file() and TS_WEIGHTS.is_dir()


def wsi_data_available() -> bool:
    """病理 WSI 数据是否就绪（当前生效源下 ship 了至少 1 例 slide）。"""
    return _available("pathology")


def wsi_live_available() -> bool:
    """核分割隔离环境是否可现算（缓存未命中时才需要）。"""
    return WSI_SEG_PYTHON.is_file() and WSI_SEG_DRIVER.is_file() and WSI_SEG_WEIGHTS.is_dir()
