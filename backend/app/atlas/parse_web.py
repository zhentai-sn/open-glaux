"""网页抽图（SDD 03 §4.1 / D-9）：抓 HTML → ``<img>`` + alt / ``<figcaption>`` / 最近段落。

安全边界（§4.3）：每个 URL（页面与图片）都过 :func:`app.net_guard.assert_url_allowed`；
只跟 http(s) 重定向且每跳再校验；超时 / 大小上限；不执行脚本、不带凭据。
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

from PIL import Image

from ..net_guard import EgressBlocked, assert_url_allowed

TIMEOUT_S = 10.0
MAX_BYTES = 10 * 1024 * 1024
MAX_IMAGES = 60
MIN_SIDE_PX = 64
UA = "GlauxAtlas/0.1 (+https://github.com/; read-only figure import)"


class FetchBlocked(Exception):
    code = "FETCH_BLOCKED"


class FetchFailed(Exception):
    code = "FETCH_FAILED"


@dataclass
class WebFigure:
    index: int
    url: str
    png: bytes
    width: int
    height: int
    caption: str
    nearby: list[str] = field(default_factory=list)


def _guard(url: str) -> None:
    try:
        assert_url_allowed(url, allow_plain_http=True)
    except EgressBlocked as exc:
        raise FetchBlocked(str(exc)) from exc


def _get(client, url: str, *, accept: str) -> tuple[bytes, str]:
    """GET + 逐跳守卫 + 大小上限。返回 ``(body, final_url)``。"""
    cur = url
    for _ in range(5):
        _guard(cur)
        try:
            r = client.get(
                cur, headers={"Accept": accept, "User-Agent": UA}, follow_redirects=False
            )
        except Exception as exc:  # noqa: BLE001
            raise FetchFailed(f"抓取失败：{cur}（{exc}）") from exc
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("location")
            if not loc:
                raise FetchFailed(f"重定向缺 Location：{cur}")
            cur = urljoin(cur, loc)
            if urlsplit(cur).scheme not in ("http", "https"):
                raise FetchBlocked(f"重定向到非 http(s)：{cur}")
            continue
        if r.status_code >= 400:
            raise FetchFailed(f"HTTP {r.status_code}：{cur}")
        if len(r.content) > MAX_BYTES:
            raise FetchFailed(f"响应超过 {MAX_BYTES // (1024 * 1024)}MB：{cur}")
        return r.content, cur
    raise FetchFailed(f"重定向过多：{url}")


def _text(el) -> str:
    return " ".join(el.get_text(" ", strip=True).split()) if el is not None else ""


def _caption_for(img) -> tuple[str, list[str]]:
    from bs4 import Tag

    alt = (img.get("alt") or "").strip()
    fig = img.find_parent("figure")
    if fig is not None:
        cap = fig.find("figcaption")
        if cap is not None and _text(cap):
            return _text(cap), [alt] if alt else []
    # 最近的后续段落 / 前置段落
    nearby: list[str] = []
    for sib in img.find_all_next(["p", "figcaption", "span", "div"], limit=6):
        if isinstance(sib, Tag):
            t = _text(sib)
            if 8 <= len(t) <= 400:
                nearby.append(t)
            if len(nearby) >= 2:
                break
    if alt:
        return alt, nearby
    return (nearby[0] if nearby else ""), nearby[1:]


def extract_figures(url: str, *, client=None) -> list[WebFigure]:
    import httpx
    from bs4 import BeautifulSoup

    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT_S)
    try:
        html, url = _get(
            client, url, accept="text/html,*/*;q=0.5"
        )  # 重定向后以最终 URL 解析相对路径
        soup = BeautifulSoup(html, "html.parser")
        out: list[WebFigure] = []
        seen: set[str] = set()
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or ""
            if not src or src.startswith("data:"):
                continue
            abs_url = urljoin(url, src)
            if urlsplit(abs_url).scheme not in ("http", "https") or abs_url in seen:
                continue
            if abs_url.lower().split("?")[0].endswith((".svg", ".gif", ".ico")):
                continue
            seen.add(abs_url)
            try:
                raw, _final = _get(client, abs_url, accept="image/*")
                im = Image.open(io.BytesIO(raw))
                im.load()
            except FetchBlocked:
                continue  # 单张被守卫拒绝 → 跳过，不让整页失败
            except Exception:  # noqa: BLE001
                continue
            if min(im.size) < MIN_SIDE_PX:
                continue
            buf = io.BytesIO()
            (im.convert("RGB") if im.mode not in ("L", "RGB") else im).save(buf, format="PNG")
            caption, nearby = _caption_for(img)
            out.append(
                WebFigure(
                    index=len(out),
                    url=abs_url,
                    png=buf.getvalue(),
                    width=im.size[0],
                    height=im.size[1],
                    caption=caption,
                    nearby=nearby,
                )
            )
            if len(out) >= MAX_IMAGES:
                break
        return out
    finally:
        if own:
            client.close()
