"""进程内单例：AtlasStore / ImageStore / Importer 按 ``config.ATLAS_ROOT`` 惰性装配。

router 与 CLI 共用；测试用 :func:`reset` + monkeypatch ``config.ATLAS_ROOT`` 指向 tmp。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .. import config
from .images import ImageStore
from .importer import Importer
from .store import AtlasStore

log = logging.getLogger("glaux.atlas")


@dataclass
class AtlasService:
    store: AtlasStore
    images: ImageStore
    importer: Importer


_svc: AtlasService | None = None
_svc_root = None


def available() -> bool:
    try:
        import lancedb  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def get() -> AtlasService:
    global _svc, _svc_root
    root = config.ATLAS_ROOT
    if _svc is None or _svc_root != root:
        store = AtlasStore(root).open()
        images = ImageStore(root)
        _svc = AtlasService(store=store, images=images, importer=Importer(root, store, images))
        _svc_root = root
        log.info("Atlas 已装配：%s", root)
    return _svc


def reset() -> None:
    global _svc, _svc_root
    _svc = None
    _svc_root = None
