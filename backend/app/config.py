"""M1 真实接入配置——路径、science-core/orchestration 装配、可用性判定。

一切路径可用环境变量覆盖；缺省指向本机 2026-07-06 下载/验证的真实资产：
- CUBS-tech 数据集：``~/cubs_data/tech_extract/DATASET_CUBS_tech``
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
DATA_ROOT = _env_path("GLAUX_DATA_ROOT", HOME / "cubs_data/tech_extract/DATASET_CUBS_tech")
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


def data_available() -> bool:
    """真实数据集是否就绪（否则端点回退 mock）。"""
    return IMAGES_DIR.is_dir() and CF_DIR.is_dir() and SEG_DIR.is_dir()


def csd_live_available() -> bool:
    """caroSegDeep 隔离环境是否可现算（缓存未命中时才需要）。"""
    return CSD_PYTHON.is_file() and CSD_DRIVER.is_file() and CSD_WEIGHTS.is_dir()
