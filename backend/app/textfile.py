"""项目文本文件的判定、编码识别与按行区间读取（SDD 14 §7.1、§7.2）。

判定只看内容（D-2）：读文件开头至多 :data:`SAMPLE_BYTES` 字节作样本，按 BOM → NUL → UTF-8 →
GB18030 的顺序识别编码；识别不出即二进制。读取为流式：``readline(limit)`` 分块，单行不整行载入，
内存上限随 ``max_bytes`` 而定；不为计数额外扫描全文件（§7.2 规则 8）。
"""

from __future__ import annotations

import codecs
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

SAMPLE_BYTES = 64 * 1024
"""编码判定读取的样本上限（SDD 14 §4.3、§7.1 规则 2）。"""

_CHUNK_CHARS = 64 * 1024
"""``readline`` 单次读取的字符数上限；超长行按此分块。"""


def detect_encoding(sample: bytes) -> str | None:
    """按 SDD 14 §7.1 规则 2 判定样本编码；``None`` 表示二进制。

    UTF-8 与 GB18030 用增量解码器且 ``final=False``：样本末尾被截断的多字节序列留在解码器缓冲里，
    不算解码失败。空样本按 UTF-8。
    """
    if sample.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"
    if sample.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return "utf-16"
    if b"\x00" in sample:
        return None
    for enc in ("utf-8", "gb18030"):
        try:
            codecs.getincrementaldecoder(enc)(errors="strict").decode(sample, final=False)
        except UnicodeDecodeError:
            continue
        return enc
    return None


@dataclass(frozen=True)
class TextSlice:
    """一次按行区间读取的结果，字段语义同 ``ProjectText``（SDD 14 §9.1）。"""

    start_line: int
    end_line: int
    text: str
    eof: bool
    total_lines: int | None
    line_truncated: bool


def _utf8_len(s: str) -> int:
    return len(s.encode("utf-8"))


def _skip_line(f: TextIO) -> bool:
    """跳过当前行剩余部分（含换行）；已在文件末尾、什么也没读到时返回 False。"""
    got = False
    while True:
        chunk = f.readline(_CHUNK_CHARS)
        if not chunk:
            return got
        got = True
        if chunk.endswith("\n"):
            return True


def _read_line_capped(f: TextIO, cap: int) -> tuple[str, bool]:
    """分块读一行，累计字节超过 ``cap`` 即停。

    返回 ``(已读内容, 是否超限)``。未超限时内容是完整一行（含换行，末行可能无换行；文件末尾为
    空串）；超限时内容是已读的若干块，可能不含整行，文件位置停在行中。
    """
    parts: list[str] = []
    size = 0
    while True:
        chunk = f.readline(_CHUNK_CHARS)
        if not chunk:
            break
        parts.append(chunk)
        size += _utf8_len(chunk)
        if size > cap:
            return "".join(parts), True
        if chunk.endswith("\n"):
            break
    return "".join(parts), False


def _truncate_utf8(s: str, max_bytes: int) -> str:
    """按字符边界截到 UTF-8 编码后不超过 ``max_bytes`` 字节。"""
    return s.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")


def _at_eof(f: TextIO) -> bool:
    """当前位置之后是否已无内容；会消耗至多一个字符，只在读取结束前调用。"""
    return f.read(1) == ""


def read_lines(
    path: Path,
    encoding: str,
    start_line: int,
    max_lines: int | None,
    max_bytes: int,
) -> TextSlice:
    """从 ``start_line`` 起顺序读取（SDD 14 §7.2 规则 4–8）。

    停止条件：已读 ``max_lines`` 行、再读一行将超过 ``max_bytes``（按返回正文的 UTF-8 字节计，
    含换行）、到达文件末尾。本次第一行即超限时按字符边界截到 ``max_bytes`` 并置 ``line_truncated``，
    跳过该行剩余部分后停止。换行由通用换行模式统一为 ``\\n``；样本以外的非法字节以 U+FFFD 替换。
    ``eof`` 表示 ``end_line`` 之后已无行；只有此时给出 ``total_lines``。
    """
    with open(path, encoding=encoding, errors="replace", newline=None) as f:
        skipped = 0
        while skipped < start_line - 1 and _skip_line(f):
            skipped += 1
        if skipped < start_line - 1:  # 起始行超出总行数（§7.2 规则 7）
            return TextSlice(start_line, start_line - 1, "", True, skipped, False)

        lines: list[str] = []
        used = 0
        truncated = False
        eof: bool | None = None  # None：停止时尚不知道后面是否还有行
        while max_lines is None or len(lines) < max_lines:
            line, over = _read_line_capped(f, max_bytes - used)
            if not line:
                eof = True
                break
            if not over:
                lines.append(line)
                used += _utf8_len(line)
                continue
            if lines:  # 已读至少一行，下一行放不下 → 停，下一行存在
                eof = False
                break
            # 第一行即超限（§7.2 规则 5）：只保留正文部分，换行不计入截断判定
            whole = line.endswith("\n")
            content = line[:-1] if whole else line
            truncated = _utf8_len(content) > max_bytes
            lines.append(_truncate_utf8(content, max_bytes))
            if not whole:
                _skip_line(f)
            break
        if eof is None:
            eof = _at_eof(f)

    n = len(lines)
    return TextSlice(
        start_line=start_line,
        end_line=start_line - 1 + n,
        text="".join(lines),
        eof=eof,
        total_lines=start_line - 1 + n if eof else None,
        line_truncated=truncated,
    )
