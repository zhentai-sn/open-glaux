"""Atlas 解析器：PDF 抽嵌入图 + 图注、扫描版/纯文本 → NO_FIGURES_FOUND；网页抽图 + 守卫。"""

from __future__ import annotations

import io

import httpx
import pytest
from PIL import Image

from app.atlas import parse_pdf, parse_web


def _png_bytes(w=120, h=80, mode="L", val=128, noise=True) -> bytes:
    im = Image.new(mode, (w, h), val)
    if noise:  # 避免被"纯色"过滤
        px = im.load()
        for x in range(0, w, 7):
            for y in range(0, h, 5):
                px[x, y] = 30 if mode == "L" else (30, 30, 30)
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def _pdf_with_figure(caption="Fig 1. Subepithelial electron dense deposits", flat=False) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 40), "Chapter 3 Membranous nephropathy")
    page.insert_image(pymupdf.Rect(50, 60, 250, 200), stream=_png_bytes(noise=not flat))
    page.insert_text((50, 220), caption)
    page.insert_text((50, 400), "Unrelated paragraph far away from the figure.")
    return doc.tobytes()


def test_pdf_extracts_figure_and_nearest_caption():
    figs = parse_pdf.extract_figures(_pdf_with_figure())
    assert len(figs) == 1
    f = figs[0]
    assert f.page == 1 and f.width == 120 and f.height == 80
    assert f.caption.startswith("Fig 1.")
    Image.open(io.BytesIO(f.png)).verify()


def test_pdf_text_only_raises_no_figures():
    import pymupdf

    doc = pymupdf.open()
    doc.new_page().insert_text((50, 50), "just text")
    with pytest.raises(parse_pdf.NoFiguresFound):
        parse_pdf.extract_figures(doc.tobytes())


def test_pdf_filters_tiny_and_flat_images():
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(10, 10, 30, 30), stream=_png_bytes(20, 20))  # 太小
    page.insert_image(pymupdf.Rect(50, 50, 250, 200), stream=_png_bytes(noise=False))  # 纯色
    with pytest.raises(parse_pdf.NoFiguresFound):
        parse_pdf.extract_figures(doc.tobytes())


# --- 网页 -------------------------------------------------------------------


def _mock_client(routes: dict[str, tuple[int, dict, bytes]]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        status, headers, body = routes.get(str(request.url), (404, {}, b""))
        return httpx.Response(status, headers=headers, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_web_extracts_img_with_figcaption_and_alt(monkeypatch):
    monkeypatch.setattr(parse_web, "assert_url_allowed", lambda url, **kw: None)  # 公网假设
    html = b"""<html><body>
      <figure><img src="/a.png"><figcaption>Fig 2 EDD under podocytes</figcaption></figure>
      <img src="/b.png" alt="Mesangial area">
      <img src="/tiny.png"><img src="data:image/png;base64,xxx"><img src="/icon.svg">
      <p>Some paragraph after.</p></body></html>"""
    routes = {
        "https://site.example/page": (200, {"content-type": "text/html"}, html),
        "https://site.example/a.png": (200, {}, _png_bytes()),
        "https://site.example/b.png": (200, {}, _png_bytes(90, 90)),
        "https://site.example/tiny.png": (200, {}, _png_bytes(20, 20)),
    }
    figs = parse_web.extract_figures("https://site.example/page", client=_mock_client(routes))
    assert [f.url.rsplit("/", 1)[1] for f in figs] == ["a.png", "b.png"]
    assert figs[0].caption == "Fig 2 EDD under podocytes" and figs[1].caption == "Mesangial area"


def test_web_blocked_url_raises_fetch_blocked():
    # 私网地址（字面 IP）→ 守卫拒绝，且不发请求
    called = {"n": 0}

    def handler(request):
        called["n"] += 1
        return httpx.Response(200, content=b"<html></html>")

    with pytest.raises(parse_web.FetchBlocked):
        parse_web.extract_figures(
            "https://10.0.0.5/page", client=httpx.Client(transport=httpx.MockTransport(handler))
        )
    assert called["n"] == 0


def test_web_follows_redirect_and_reguards(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(parse_web, "assert_url_allowed", lambda url, **kw: seen.append(url))
    routes = {
        "https://a.example/": (302, {"location": "https://b.example/page"}, b""),
        "https://b.example/page": (200, {}, b"<html><img src='x.png' alt='X'></html>"),
        "https://b.example/x.png": (200, {}, _png_bytes()),
    }
    figs = parse_web.extract_figures("https://a.example/", client=_mock_client(routes))
    assert len(figs) == 1 and "https://b.example/page" in seen and "https://b.example/x.png" in seen


def test_web_http_error_is_fetch_failed(monkeypatch):
    monkeypatch.setattr(parse_web, "assert_url_allowed", lambda url, **kw: None)
    with pytest.raises(parse_web.FetchFailed):
        parse_web.extract_figures("https://a.example/missing", client=_mock_client({}))
