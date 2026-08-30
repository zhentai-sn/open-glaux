"""上传图像的落盘规则与 ID 派生（SDD 08 §7 规则 5–7、§9.2/§9.3）。

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
_MAGIC: dict[str, bytes] = {
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".png": b"\x89PNG\r\n\x1a\n",
}
# 落盘用的规范扩展名（.jpeg 归一到 .jpg，避免同一张图两种后缀两个 ID）。
_CANONICAL = {".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png"}
MAGIC_PREFIX_LEN = max(len(m) for m in _MAGIC.values())

#: 拒绝原因（SDD 08 §9.2 的 enum，顺序即判定顺序）。
REASON_UNSUPPORTED = "unsupported_type"
REASON_TOO_LARGE = "too_large"
REASON_CORRUPT = "corrupt"

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

    返回 ``("accept", 规范扩展名)`` 或 ``("reject", 原因)``；原因取 §9.2 的三个 enum 值。
    判定顺序即 §13 表格顺序：类型 → 大小 → 魔数。
    """
    ext = Path(filename).suffix.lower()
    if ext not in _MAGIC:
        return ("reject", REASON_UNSUPPORTED)
    if size > config.UPLOAD_MAX_BYTES:
        return ("reject", REASON_TOO_LARGE)
    if not head.startswith(_MAGIC[ext]):
        # 扩展名合法但内容不是——改名的文本文件、截断的图，都落这里
        return ("reject", REASON_CORRUPT)
    return ("accept", _CANONICAL[ext])


def is_supported_file(path: Path) -> bool:
    """目录列举时的过滤：后缀在白名单内即可（内容校验留给取图，避免列表逐个读文件头）。"""
    return path.is_file() and path.suffix.lower() in _CANONICAL
