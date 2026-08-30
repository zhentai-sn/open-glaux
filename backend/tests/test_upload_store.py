"""上传规则层（SDD 08 §7 规则 5–7、§9.2/§9.3）——纯函数，不起 HTTP。

重点是那条结构性防线：**客户端文件名不进路径**。所以这里既验 classify 的三类拒绝，
也验 store_name / image_id 对恶意文件名的处理——不是「清洗后看起来安全」，而是「输出里
根本不含输入的任何字面片段」。
"""

from __future__ import annotations

import pytest

from app import config
from app import upload_store as us

JPEG = b"\xff\xd8\xff\xe0"
PNG = b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(
    ("filename", "head", "size", "expected"),
    [
        ("a.jpg", JPEG, 10, ("accept", ".jpg")),
        ("a.JPEG", JPEG, 10, ("accept", ".jpg")),  # 大小写与 .jpeg 都归一到 .jpg
        ("a.png", PNG, 10, ("accept", ".png")),
        ("scan.tiff", b"II*\x00", 10, ("reject", us.REASON_UNSUPPORTED)),
        ("noext", JPEG, 10, ("reject", us.REASON_UNSUPPORTED)),
        ("a.jpg", JPEG, config.UPLOAD_MAX_BYTES + 1, ("reject", us.REASON_TOO_LARGE)),
        ("text.jpg", b"hello wo", 10, ("reject", us.REASON_CORRUPT)),  # 改名的文本文件
        ("swap.png", JPEG, 10, ("reject", us.REASON_CORRUPT)),  # 扩展名对不上魔数
    ],
)
def test_classify(filename, head, size, expected):
    assert us.classify(filename, head, size) == expected


def test_classify_order_type_before_size():
    """类型判定先于大小：一个超大的 .tiff 报 unsupported_type，而不是 too_large。"""
    assert us.classify("x.tiff", b"II*\x00", config.UPLOAD_MAX_BYTES * 2) == (
        "reject",
        us.REASON_UNSUPPORTED,
    )


def test_image_id_shape_and_determinism():
    a = us.image_id("imported-abc12345", "img-0001.jpg")
    assert us.IMAGE_ID_RE.match(a)
    assert a == us.image_id("imported-abc12345", "img-0001.jpg")  # 同参恒等
    assert a != us.image_id("imported-abc12345", "img-0002.jpg")  # 换文件
    assert a != us.image_id("imported-99999999", "img-0001.jpg")  # 换源


def test_store_name_carries_no_client_string():
    """落盘名只由哈希构成——恶意文件名的任何片段都不出现在结果里（D7）。"""
    for evil in ("../../etc/passwd.jpg", "..\\..\\win.jpg", "a/b/c.jpg", "🙀.jpg"):
        name = us.store_name(evil, ".jpg")
        assert name.startswith("img-") and name.endswith(".jpg")
        assert "/" not in name and "\\" not in name and ".." not in name
        # 不含输入的任何非扩展名片段
        assert "passwd" not in name and "win" not in name


def test_source_dir_under_uploads_root():
    """目录名同样只由哈希构成，且必在 uploads/ 之下——register_folder 的白名单才拦得住。"""
    d = us.source_dir("../../../etc")
    assert d.parent == us.uploads_root()
    assert d.name.startswith("u-") and ".." not in d.name


def test_uploads_root_inside_datasets_root():
    from app import datasource_registry as reg

    assert us.uploads_root().is_relative_to(reg.datasets_root())


def test_is_supported_file(tmp_path):
    ok = tmp_path / "a.PNG"
    ok.write_bytes(PNG)
    bad = tmp_path / "a.txt"
    bad.write_bytes(b"x")
    assert us.is_supported_file(ok)
    assert not us.is_supported_file(bad)
    assert not us.is_supported_file(tmp_path)  # 目录不是文件
