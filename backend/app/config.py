"""M1 真实接入配置——路径、science-core 装配、可用性判定。

一切路径可用环境变量覆盖；缺省指向本机 2026-07-06 下载/验证的真实资产：
- CUBS-tech 数据集：``~/glaux_datasets/cubs_data/tech_extract/DATASET_CUBS_tech``
- caroSegDeep 隔离环境：``~/glaux_models/caroSegDeep/.venv-csd`` + ``run_headless.py``
- caroSegDeep 真实产出缓存（eval 100 图 tech_401–500）：``~/glaux_models/csd_out``

数据不可用时列表为空、未知 id 为 404；开发者模式下另有显式注册的合成源（见 mock.py / hc_synth.py）。
主进程只 import science-core（纯 numpy/PIL），**绝不引入 TF**——
TF 隔离在 caroSegDeep 的 .venv-csd 子进程（见 segment_proc.py）。
主进程也不含任何 LLM SDK：与模型说话的唯一进程是 agent-runtime（退役 orchestration，2026-08-16）。
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

# --- 源码装配：把 science-core 挂上 sys.path（不改其打包） ---------------------
_SCIENCE_CORE = _env_path("GLAUX_SCIENCE_CORE", REPO_ROOT / "science-core")
if _SCIENCE_CORE.is_dir() and str(_SCIENCE_CORE) not in sys.path:
    sys.path.insert(0, str(_SCIENCE_CORE))

# --- 数据集路径（CUBS-tech） -------------------------------------------------
DATA_ROOT = _env_path(
    "GLAUX_DATA_ROOT", HOME / "glaux_datasets/cubs_data/tech_extract/DATASET_CUBS_tech"
)
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

# --- 通用自然图像：SAM API 演示资产（非 science-core 任务、无标定）-------------
NATURAL_ROOT = _env_path("GLAUX_NATURAL_ROOT", REPO_ROOT / "data/natural")


def _env_int(key: str, default: int) -> int:
    """整型环境变量——非数字/非正数回缺省（配置写错不该让服务起不来，也不该放开上限）。"""
    raw = os.environ.get(key)
    if raw is None:
        return default
    try:
        v = int(raw.strip())
    except ValueError:
        return default
    return v if v > 0 else default


# --- 浏览器图像上传（SDD 08 §4.3）：单文件与单次数量上限 -----------------------
# 只有这两道闸；总容量配额是后续工作，不在本轮范围（见实施计划 §10）。
UPLOAD_MAX_BYTES = _env_int("GLAUX_UPLOAD_MAX_BYTES", 32 * 1024 * 1024)  # 32 MiB
UPLOAD_MAX_FILES = _env_int("GLAUX_UPLOAD_MAX_FILES", 20)

# --- Atlas · 图谱（SDD 03）：LanceDB 案例表 + 原图/裁剪图目录 ------------------------
# 独立于数据集根（图谱是跨数据源的人工资产）；下设 db/（LanceDB）与 images/。
ATLAS_ROOT = _env_path("GLAUX_ATLAS_ROOT", HOME / "glaux_atlas")

# --- 统一标注存储（SDD 04）：annotations.sqlite + masks/ PNG ------------------------
# 独立于数据集根（标注是跨数据源的人工/agent 资产，对齐 ATLAS_ROOT 惯例）。
ANNOTATIONS_ROOT = _env_path("GLAUX_ANNOTATIONS_ROOT", HOME / "glaux_annotations")
# 描述生成走 agent-runtime（主进程无 LLM SDK）；导入期调用，失败不阻塞入库。
AGENT_RUNTIME_URL = os.environ.get("GLAUX_AGENT_RUNTIME_URL", "http://127.0.0.1:8010")

# WSI vendor 格式后缀（OpenSlide 支持面的子集；v0 走 .svs demo）。
_WSI_SUFFIXES = (".svs", ".ndpi", ".tif", ".tiff", ".mrxs", ".scn", ".vms", ".bif")


def root_has_data(modality: str, root: Path) -> bool:
    """某模态在给定 ``root`` 下是否有数据——薄 alias，判据在 ``SOURCES[modality].probe``。

    **不查注册表**（直接判目录），故可安全用作内置源探针，不会与
    :func:`datasource_registry.resolve_root` 递归。未注册的模态 → False。
    """
    from .sources import SOURCES  # 延迟导入：SOURCES 会导入各数据模块

    src = SOURCES.get(modality)
    return src is not None and src.probe(root)


def _available(modality: str) -> bool:
    """某模态数据是否就绪——注册表感知：当前生效源（resolve_root）下有数据即就绪。

    开发者模式下 resolve_root 返回内置源 root（== 本文件的 X_ROOT 默认），行为与改前一致；
    产品模式无源 → None → False。
    """
    from . import datasource_registry as reg  # 延迟导入，避免模块级循环

    root = reg.resolve_root(modality)
    return root is not None and root_has_data(modality, root)


def data_available() -> bool:
    """真实 CUBS 数据集是否就绪。"""
    return _available("carotid_imt")


def csd_live_available() -> bool:
    """caroSegDeep 隔离环境是否可现算（缓存未命中时才需要）。"""
    return CSD_PYTHON.is_file() and CSD_DRIVER.is_file() and CSD_WEIGHTS.is_dir()


def hc_data_available() -> bool:
    """HC18 真实数据集是否就绪。"""
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
