"""SDD 14 W1：项目文本文件判定、编码识别与 ``GET /projects/{id}/text``（§7.1、§7.2、§15.1）。"""

from __future__ import annotations

import codecs
import io
import os
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import datasource_registry as reg
from app.main import app
from app.routers.loopback import require_loopback
from app.textfile import SAMPLE_BYTES, detect_encoding, read_lines

client = TestClient(app)

MIB = 1024 * 1024


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """每测隔离：落盘清单 + 白名单根指向 tmp，注册表、项目表与索引清空；回环守卫放行。"""
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()
    app.dependency_overrides[require_loopback] = lambda: None
    yield
    app.dependency_overrides.pop(require_loopback, None)
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()


@pytest.fixture
def project(tmp_path):
    """项目目录 ``proj/``：一份文本、一个子目录、``.env`` 与 ``.git/config``。"""
    root = tmp_path / "proj"
    (root / "sub").mkdir(parents=True)
    (root / ".git").mkdir()
    (root / "notes.txt").write_text("hello\nworld\n", encoding="utf-8")
    (root / ".env").write_text("SECRET=1\n", encoding="utf-8")
    (root / ".git" / "config").write_text("[core]\n", encoding="utf-8")
    prj, _ = reg.register_project(root)
    return prj


def _text(prj, path: str, **params):
    return client.get(f"/projects/{prj.id}/text", params={"path": path, **params})


def _code(r) -> str:
    return r.json()["detail"]["code"]


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (5, 4), (10, 200, 10)).save(buf, format="PNG")
    return buf.getvalue()


def _zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "hello")
    return buf.getvalue()


# --- 文本判定与编码 -------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "encoding"),
    [
        ("# 报告\nabc\n".encode(), "utf-8"),
        (codecs.BOM_UTF8 + "# 报告\nabc\n".encode(), "utf-8-sig"),
        (codecs.BOM_UTF16_LE + "# 报告\nabc\n".encode("utf-16-le"), "utf-16"),
        (codecs.BOM_UTF16_BE + "# 报告\nabc\n".encode("utf-16-be"), "utf-16"),
        ("# 报告\nabc\n".encode("gb18030"), "gb18030"),
    ],
)
def test_encodings(project, raw, encoding):
    (project.path / "doc.md").write_bytes(raw)
    r = _text(project, "doc.md")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["encoding"] == encoding
    assert body["text"] == "# 报告\nabc\n"  # BOM 不进正文
    assert body["size"] == len(raw)
    assert (body["path"], body["name"]) == ("doc.md", "doc.md")
    assert (body["start_line"], body["end_line"]) == (1, 2)
    assert (body["eof"], body["total_lines"]) == (True, 2)
    assert body["line_truncated"] is False


@pytest.mark.parametrize(
    ("name", "raw"),
    [
        ("nul.txt", b"abc\x00def\n"),
        ("x.png", _png()),
        ("x.zip", _zip()),
        ("x.bin", b"\xff" * 16),  # 无 NUL，但 UTF-8 与 GB18030 都解不了
    ],
)
def test_binary_rejected(project, name, raw):
    (project.path / name).write_bytes(raw)
    r = _text(project, name)
    assert (r.status_code, _code(r)) == (422, "binary")


def test_sample_boundary_splits_multibyte_char(project):
    """第 65536 字节落在三字节汉字中间：样本严格解码会失败，但截断序列不算失败 → utf-8。"""
    raw = b"a" * (SAMPLE_BYTES - 2) + "中\n".encode()
    sample = raw[:SAMPLE_BYTES]
    with pytest.raises(UnicodeDecodeError):
        sample.decode("utf-8")
    assert detect_encoding(sample) == "utf-8"
    (project.path / "edge.txt").write_bytes(raw)
    body = _text(project, "edge.txt").json()
    assert body["encoding"] == "utf-8"
    assert body["text"].endswith("中\n")


def test_detect_encoding_rules():
    assert detect_encoding(b"") == "utf-8"
    assert detect_encoding(b"\xef\xbb\xbfabc") == "utf-8-sig"
    assert detect_encoding(b"\xff\xfea\x00") == "utf-16"  # BOM 先于 NUL 检测
    assert detect_encoding(b"a\x00b") is None
    assert detect_encoding("中文".encode("gb18030")) == "gb18030"


def test_invalid_bytes_beyond_sample_replaced(project):
    raw = b"a" * SAMPLE_BYTES + b"\n\xff\xfe tail\n"
    (project.path / "tail.log").write_bytes(raw)
    body = _text(project, "tail.log", start_line=2).json()
    assert body["encoding"] == "utf-8"
    assert body["text"] == "�� tail\n"


# --- 路径校验 -------------------------------------------------------------------


def test_outside_and_hidden(project, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("x")
    (project.path / "link.txt").symlink_to(outside)
    (project.path / "linkdir").symlink_to(tmp_path, target_is_directory=True)
    for p in ("../outside.txt", "sub/../../outside.txt", str(outside), "link.txt",
              "linkdir/outside.txt"):
        r = _text(project, p)
        assert (r.status_code, _code(r)) == (422, "outside_project"), p
    (project.path / "env").symlink_to(project.path / ".env")  # 指向隐藏文件的链接同样拒绝
    for p in (".env", ".git/config", "sub/.secret", ".git", "env"):
        r = _text(project, p)
        assert (r.status_code, _code(r)) == (422, "hidden_path"), p
    assert _text(project, "./notes.txt").json()["path"] == "notes.txt"


def test_not_found_not_file_project_not_found(project):
    r = _text(project, "nope.txt")
    assert (r.status_code, _code(r)) == (404, "not_found")
    r = _text(project, "sub")
    assert (r.status_code, _code(r)) == (422, "not_file")
    r = client.get("/projects/prj-00000000/text", params={"path": "notes.txt"})
    assert (r.status_code, _code(r)) == (404, "project_not_found")


@pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0, reason="需非 root 的 POSIX 权限位")
def test_unreadable_file_403(project):
    f = project.path / "locked.txt"
    f.write_text("x")
    f.chmod(0)
    try:
        assert _text(project, "locked.txt").status_code == 403
    finally:
        f.chmod(0o644)


@pytest.mark.parametrize(
    "params",
    [
        {"start_line": 0},
        {"max_lines": 0},
        {"max_lines": 100001},
        {"max_bytes": 0},
        {"max_bytes": MIB + 1},
    ],
)
def test_param_out_of_range(project, params):
    assert _text(project, "notes.txt", **params).status_code == 422


def test_path_required(project):
    assert client.get(f"/projects/{project.id}/text").status_code == 422


def test_requires_loopback(project):
    app.dependency_overrides.pop(require_loopback, None)
    assert _text(project, "notes.txt").status_code == 403


# --- 行区间与字节上限 -----------------------------------------------------------


@pytest.fixture
def thousand(project):
    (project.path / "k.txt").write_text("".join(f"line {i}\n" for i in range(1, 1001)))
    return project


def _lines(a: int, b: int) -> str:
    return "".join(f"line {i}\n" for i in range(a, b + 1))


def test_line_ranges(thousand):
    b = _text(thousand, "k.txt", start_line=401, max_lines=400).json()
    assert (b["start_line"], b["end_line"], b["eof"], b["total_lines"]) == (401, 800, False, None)
    assert b["text"] == _lines(401, 800)
    b = _text(thousand, "k.txt", start_line=801, max_lines=400).json()
    assert (b["start_line"], b["end_line"], b["eof"], b["total_lines"]) == (801, 1000, True, 1000)
    assert b["text"] == _lines(801, 1000)
    # 恰好读到最后一行即满 max_lines：同样判定为 eof
    b = _text(thousand, "k.txt", start_line=601, max_lines=400).json()
    assert (b["end_line"], b["eof"], b["total_lines"]) == (1000, True, 1000)
    # 不限行数
    b = _text(thousand, "k.txt").json()
    assert (b["end_line"], b["eof"], b["total_lines"]) == (1000, True, 1000)


@pytest.mark.parametrize("start", [1001, 5000])
def test_start_beyond_total(thousand, start):
    b = _text(thousand, "k.txt", start_line=start).json()
    assert (b["text"], b["eof"], b["total_lines"]) == ("", True, 1000)
    assert b["end_line"] == start - 1


def test_five_mib_file_capped(project):
    line = "x" * 99 + "\n"
    (project.path / "big.log").write_text(line * (5 * MIB // len(line)))
    b = _text(project, "big.log", max_bytes=MIB).json()
    assert len(b["text"].encode()) <= MIB
    assert b["text"] == line * b["end_line"]  # 只含整行
    assert (b["eof"], b["total_lines"], b["line_truncated"]) == (False, None, False)


def test_single_long_line_truncated(project):
    """单行 3 MiB（三字节汉字）：按字符边界截到 1 MiB 以内，``end_line`` 等于该行。"""
    (project.path / "min.json").write_text("中" * MIB + "\n", encoding="utf-8")
    b = _text(project, "min.json").json()
    assert b["line_truncated"] is True
    assert b["end_line"] == 1
    data = b["text"].encode()
    assert MIB - 3 < len(data) <= MIB
    assert set(b["text"]) == {"中"}


def _t(s) -> tuple:
    """``TextSlice`` → ``(text, end_line, eof, total_lines, line_truncated)``。"""
    return (s.text, s.end_line, s.eof, s.total_lines, s.line_truncated)


def test_long_first_line_then_more(tmp_path):
    f = tmp_path / "t.txt"
    f.write_text("a" * 10 + "\nnext\n")
    assert _t(read_lines(f, "utf-8", 1, None, 4)) == ("aaaa", 1, False, None, True)
    # 仅换行放不下：正文完整，不算截断
    assert _t(read_lines(f, "utf-8", 1, None, 10)) == ("a" * 10, 1, False, None, False)
    assert _t(read_lines(f, "utf-8", 2, None, 4)) == ("next", 2, True, 2, False)


def test_stop_before_line_exceeding_budget(tmp_path):
    f = tmp_path / "t.txt"
    f.write_text("ab\ncd\n")
    assert _t(read_lines(f, "utf-8", 1, None, 5)) == ("ab\n", 1, False, None, False)
    assert _t(read_lines(f, "utf-8", 1, None, 6)) == ("ab\ncd\n", 2, True, 2, False)
    assert _t(read_lines(f, "utf-8", 1, 1, 6)) == ("ab\n", 1, False, None, False)


def test_empty_file(project):
    (project.path / "empty.txt").write_bytes(b"")
    b = _text(project, "empty.txt").json()
    assert (b["text"], b["total_lines"], b["eof"], b["end_line"]) == ("", 0, True, 0)
    assert b["encoding"] == "utf-8"


def test_crlf_and_cr_normalized(project):
    (project.path / "lf.txt").write_bytes(b"a\nb\n\nc")
    (project.path / "crlf.txt").write_bytes(b"a\r\nb\r\n\r\nc")
    (project.path / "cr.txt").write_bytes(b"a\rb\r\rc")
    bodies = [_text(project, n).json() for n in ("lf.txt", "crlf.txt", "cr.txt")]
    for b in bodies:
        assert "\r" not in b["text"]
        assert (b["text"], b["total_lines"]) == ("a\nb\n\nc", 4)


def test_crlf_at_chunk_boundary(tmp_path):
    """``\\r\\n`` 恰好跨 ``readline`` 分块边界时仍按一个换行计。"""
    f = tmp_path / "t.txt"
    f.write_bytes(b"x" * (64 * 1024 - 1) + b"\r\nnext\r\n")
    s = read_lines(f, "utf-8", 1, None, MIB)
    assert s.total_lines == 2
    assert s.text == "x" * (64 * 1024 - 1) + "\nnext\n"


# --- 只读 -----------------------------------------------------------------------


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    return {
        str(p.relative_to(root)): (p.lstat().st_size, p.lstat().st_mtime_ns)
        for p in root.rglob("*")
    }


def test_read_does_not_register_or_write(project):
    (project.path / "report.md").write_text("# hi\n")
    sources = Path(reg.sources_file())
    before_sources = sources.read_bytes() if sources.exists() else None
    before_tree = _snapshot(project.path)
    for p in ("report.md", "notes.txt", ".env", "nope.txt"):
        _text(project, p)
    after_sources = sources.read_bytes() if sources.exists() else None
    assert after_sources == before_sources
    assert _snapshot(project.path) == before_tree
    assert [s for s in reg._SOURCES.values() if s.project_id == project.id] == []
