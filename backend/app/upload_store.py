"""上传文件的落盘规则与 ID 派生（SDD 08 §7 规则 5–7、§9.2/§9.3）。

纯 stdlib + config，不 import FastAPI——HTTP 层只负责取字节与拼响应，**校验与命名规则住在这里**，
可独立测。

核心不变量（D7，沿用 SDD 07 D-5 的同一条防线）：**客户端文件名一律不进入文件系统路径**。
落盘名与图像 ID 都由服务端从哈希确定性派生，原始文件名只回显在响应里。路径穿越因此在结构上
不可能，而不是靠清洗字符串——后者永远在和下一个编码技巧赛跑。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from . import config

# 扩展名 → 该类型必须具备的文件头魔数。扩展名与魔数**都要**过，只对一个不算数（§7 规则 5）。
# 魔数表的唯一来源是各 Source 的 ``formats``（SDD 10 §4.1）：(后缀, 魔数, offset)。
# 落盘用的规范扩展名：.jpeg 归一到 .jpg，避免同一张图两种后缀两个 ID。
_ALIAS = {".jpeg": ".jpg"}


def _formats() -> dict[str, tuple[bytes, int, str]]:
    """后缀 → (魔数, offset, modality)，按 SOURCES 登记顺序汇总；同后缀先登记者胜出。"""
    from .sources import SOURCES  # 延迟导入：SOURCES 会导入各数据模块

    out: dict[str, tuple[bytes, int, str]] = {}
    for modality, src in SOURCES.items():
        for ext, magic, offset in src.formats:
            out.setdefault(ext.lower(), (magic, offset, modality))
    return out


def accepted_extensions() -> list[str]:
    """浏览器上传受理后缀；含尚无数据源的模态。"""
    return list(_formats())


def magic_prefix_len() -> int:
    """判定魔数需要读的文件头字节数。"""
    return max((len(m) + off for m, off, _ in _formats().values()), default=0)


def upload_max_bytes(filename: str) -> int:
    """按后缀取所属 Source 声明的单文件上限；不受理的后缀取通用上限。"""
    from .sources import SOURCES

    modality = modality_of(filename)
    return SOURCES[modality].upload_max_bytes() if modality else config.UPLOAD_MAX_BYTES


def modality_of(filename: str) -> str | None:
    """按后缀推断上传文件的模态；不受理的后缀 → None。"""
    hit = _formats().get(Path(filename).suffix.lower())
    return hit[2] if hit else None


#: 通用拒绝原因（SDD 08 §9.2）；视频解码与时长原因见 SDD 11 §13。
REASON_UNSUPPORTED = "unsupported_type"
REASON_TOO_LARGE = "too_large"
REASON_CORRUPT = "corrupt"
REASON_UNSUPPORTED_CODEC = "unsupported_codec"
REASON_DURATION_EXCEEDED = "duration_exceeded"

IMAGE_ID_RE = re.compile(r"^nat-[0-9a-f]{8}-[0-9a-f]{8}$")


def _sha1(text: str, n: int = 8) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


def uploads_root() -> Path:
    """上传落盘根——必在导入白名单根之下，使 ``register_folder`` 的越界校验依然成立（§7 规则 8）。"""
    from . import datasource_registry as reg  # 延迟导入，避免模块级循环

    return reg.datasets_root() / "uploads"


def source_dir(name: str) -> Path:
    """按数据源**展示名**派生落盘目录。

    同名 → 同目录 → ``register_folder`` 给出同一个 source id，于是「重复上传到同一数据源」是
    更新而非新建（§10）。名字本身不进路径，只进哈希（D7）。
    """
    return uploads_root() / f"u-{_sha1(name, 12)}"


def store_name(filename: str, ext: str) -> str:
    """落盘文件名——由客户端文件名哈希而来，同名重传覆盖同一文件，故 ID 稳定（§10）。"""
    return f"img-{_sha1(filename, 12)}{ext}"


def image_id(source_id: str, rel_name: str) -> str:
    """图像 ID = ``nat-<源哈希8>-<源内相对文件名哈希8>``（§9.3）。

    确定性：同源同文件名恒得同 ID，故列表与取图无需维护可变索引。
    """
    return f"nat-{_sha1(source_id)}-{_sha1(rel_name)}"


def classify(filename: str, head: bytes, size: int) -> tuple[str, str]:
    """单个上传文件的受理判定。

    返回 ``("accept", 规范扩展名)`` 或 ``("reject", 原因)``；字节上限由所属 Source 声明。
    判定顺序即 §13 表格顺序：类型 → 大小 → 魔数。
    """
    ext = Path(filename).suffix.lower()
    fmt = _formats().get(ext)
    if fmt is None:
        return ("reject", REASON_UNSUPPORTED)
    if size > upload_max_bytes(filename):
        return ("reject", REASON_TOO_LARGE)
    magic, offset, _modality = fmt
    if head[offset : offset + len(magic)] != magic:
        # 扩展名合法但内容不是——改名的文本文件、截断的图，都落这里
        return ("reject", REASON_CORRUPT)
    return ("accept", _ALIAS.get(ext, ext))


def is_supported_file(path: Path, modality: str | None = None) -> bool:
    """目录列举时的过滤：后缀在受理表内即可（内容校验留给取图，避免列表逐个读文件头）。

    给 ``modality`` 时只认该模态的后缀。
    """
    if not path.is_file():
        return False
    fmt = _formats().get(path.suffix.lower())
    return fmt is not None and (modality is None or fmt[2] == modality)
