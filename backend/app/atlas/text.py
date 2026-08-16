"""标签归一与检索文本合成（SDD 03 §7.2 / §7.5 / §7.6）。

纯函数、无 IO，便于单测与在 store / router 间复用。
"""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any


def normalize_tag(raw: str) -> str:
    """trim → NFKC（全角转半角）→ casefold。空串归一后仍为空，调用方负责丢弃。"""
    return unicodedata.normalize("NFKC", raw).strip().casefold()


def normalize_tags(raw: Iterable[str]) -> tuple[list[str], list[str]]:
    """返回 ``(tags, tags_raw)``：归一后去重（保序）；原文按归一后的首个出现保留。"""
    seen: dict[str, str] = {}
    for r in raw:
        n = normalize_tag(r)
        if n and n not in seen:
            seen[n] = r.strip()
    return list(seen.keys()), list(seen.values())


def _walk_values(obj: Any) -> Iterable[str]:
    if obj is None:
        return
    if isinstance(obj, str):
        if obj.strip():
            yield obj.strip()
    elif isinstance(obj, Mapping):
        for v in obj.values():
            yield from _walk_values(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk_values(v)
    elif isinstance(obj, (int, float)):
        yield str(obj)


def build_search_text(
    caption: str | None,
    description: Mapping[str, Any] | None,
    notes: str | None = None,
) -> str:
    """合成 FTS 列：图注 + 描述 ``summary`` + ``findings[].name`` + ``extra`` 的值 + 用户说明。

    只取 SDD §7.6 指定的检索字段，其余描述字段（如 ``modality``/``pattern``）不进检索文本，
    避免"TEM"这类通用词稀释相关度。
    """
    parts: list[str] = []
    if caption and caption.strip():
        parts.append(caption.strip())
    if description:
        summary = description.get("summary")
        if isinstance(summary, str) and summary.strip():
            parts.append(summary.strip())
        findings = description.get("findings")
        if isinstance(findings, list):
            for f in findings:
                if isinstance(f, Mapping):
                    name = f.get("name")
                    if isinstance(name, str) and name.strip():
                        parts.append(name.strip())
        extra = description.get("extra")
        if isinstance(extra, Mapping):
            parts.extend(_walk_values(extra))
    if notes and notes.strip():
        parts.append(notes.strip())
    return "\n".join(parts)
