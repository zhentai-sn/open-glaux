"""导入编排（SDD 03 §6.1 / §6.2 / §7.8 / §10）：上传即入库、改 ROI、追加区域。

- **上传**（:meth:`Importer.upload_files` / :meth:`Importer.upload_url`）：图片一文件一条，
  PDF / 网页每张插图一条；ROI 取整图、标签空、``reviewed=False``，描述由前端经用户确认后生成写回。
  先全部解析再落盘：超出单次上限整批拒绝，不部分入库；单个文件解析失败只记入该文件的错误。
- **创建**（:meth:`Importer.create`）：CLI 与 ``POST /exemplars`` 用，图片随请求携带。
- 幂等由 :class:`AtlasStore` 保证；``describe_status`` 初始 ``pending``。
"""

from __future__ import annotations

import base64
import io
import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from . import parse_pdf, parse_web
from .images import ImageStore, Roi, clamp_roi
from .store import AtlasError, AtlasStore, NewExemplar

log = logging.getLogger("glaux.atlas")

MAX_FILES = 50
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_ITEMS = 200
LEGACY_XYXY_SOURCES = ("textbook", "web")  # v1 向导写入的来源，ROI 存成了 x0,y0,x1,y1


@dataclass
class ExemplarInput:
    """创建一条案例的输入（router 的 pydantic 模型 / CLI 转换而来）。"""

    roi: Roi
    tags: Sequence[str]
    source_type: str
    source: Mapping[str, Any]
    image_base64: str | None = None
    egress: str = "local-only"
    egress_consent: Mapping[str, Any] | None = None
    caption: str | None = None
    notes: str | None = None
    geometry: Sequence[Sequence[float]] | None = None
    collection: str | None = None
    reviewed: bool = False


@dataclass
class UploadFile:
    filename: str
    data: bytes


@dataclass
class _Parsed:
    """解析后、落盘前的一张图。"""

    file: str
    data: bytes
    source_type: str
    source: dict[str, Any]
    caption: str | None = None


@dataclass
class UploadResult:
    batch_id: str
    items: list[dict[str, Any]] = field(default_factory=list)  # {exemplar_id, created, file}
    errors: list[dict[str, str]] = field(default_factory=list)  # {file, code, message}


def _is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def _is_image(data: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        return True
    except Exception:  # noqa: BLE001
        return False


def _whole(size: tuple[int, int]) -> Roi:
    return (0, 0, int(size[0]), int(size[1]))


class Importer:
    def __init__(self, root: Path, store: AtlasStore, images: ImageStore):
        self.root = Path(root)
        self.store = store
        self.images = images

    # --- 上传（v2.0） ------------------------------------------------------------

    def upload_files(
        self, files: Sequence[UploadFile], *, collection: str | None = None
    ) -> UploadResult:
        if len(files) > MAX_FILES:
            raise AtlasError("UPLOAD_TOO_LARGE", f"单次最多 {MAX_FILES} 个文件")
        too_big = [f.filename for f in files if len(f.data) > MAX_FILE_BYTES]
        if too_big:
            raise AtlasError(
                "UPLOAD_TOO_LARGE",
                f"单文件上限 {MAX_FILE_BYTES // (1024 * 1024)} MB：{', '.join(too_big)}",
            )
        result = UploadResult(batch_id=uuid.uuid4().hex)
        parsed: list[_Parsed] = []
        for f in files:
            try:
                parsed.extend(self._parse_file(f))
            except AtlasError as exc:
                result.errors.append({"file": f.filename, "code": exc.code, "message": str(exc)})
        return self._commit(parsed, result, collection)

    def upload_url(self, url: str, *, collection: str | None = None, client=None) -> UploadResult:
        """网页全部图片入库。守卫拒绝 / 抓取失败 / 无图整请求报错（单一来源，无"同批其它文件"）。"""
        figs = parse_web.extract_figures(url, client=client)  # 抛 FetchBlocked / FetchFailed
        if not figs:
            raise parse_pdf.NoFiguresFound("页面内未找到可用图片")
        parsed = [
            _Parsed(
                file=f.url,
                data=f.png,
                source_type="web",
                source={"url": url, "image_url": f.url},
                caption=f.caption or None,
            )
            for f in figs
        ]
        return self._commit(parsed, UploadResult(batch_id=uuid.uuid4().hex), collection)

    def _parse_file(self, f: UploadFile) -> list[_Parsed]:
        if not f.data:
            raise AtlasError("BAD_IMAGE", "空文件")
        if _is_pdf(f.data):
            try:
                figs = parse_pdf.extract_figures(f.data)
            except parse_pdf.NoFiguresFound as exc:
                raise AtlasError(exc.code, str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 - 损坏 PDF
                raise AtlasError("BAD_PDF", f"PDF 无法解析：{exc}") from exc
            base: dict[str, Any] = {"filename": f.filename}
            title = parse_pdf.pdf_title(f.data)
            if title:
                base["title"] = title
            return [
                _Parsed(
                    file=f.filename,
                    data=fig.png,
                    source_type="textbook",
                    source={**base, "page": fig.page, "figure": fig.index},
                    caption=fig.caption or None,
                )
                for fig in figs
            ]
        if _is_image(f.data):
            return [
                _Parsed(
                    file=f.filename,
                    data=f.data,
                    source_type="upload",
                    source={"filename": f.filename},
                )
            ]
        raise AtlasError("UNSUPPORTED_FILE", "只支持图片与 PDF")

    def _commit(
        self, parsed: Sequence[_Parsed], result: UploadResult, collection: str | None
    ) -> UploadResult:
        if len(parsed) > MAX_ITEMS:
            raise AtlasError(
                "UPLOAD_TOO_LARGE", f"单次最多产生 {MAX_ITEMS} 条案例（本次 {len(parsed)} 条）"
            )
        prepared: list[NewExemplar] = []
        files: list[str] = []
        for p in parsed:
            try:
                image_ref, sha, size = self.images.save_original(p.data)
            except Exception as exc:  # noqa: BLE001 - PIL 解码失败
                result.errors.append(
                    {"file": p.file, "code": "BAD_IMAGE", "message": f"图像无法解码：{exc}"}
                )
                continue
            prepared.append(
                NewExemplar(
                    image_ref=image_ref,
                    image_sha256=sha,
                    roi=_whole(size),
                    tags=[],
                    source_type=p.source_type,  # type: ignore[arg-type]
                    source=p.source,
                    import_batch_id=result.batch_id,
                    caption=p.caption,
                    collection=collection,
                    reviewed=False,
                )
            )
            files.append(p.file)
        if prepared:
            out = self.store.create(prepared)
            self.store.optimize()
            result.items = [
                {"exemplar_id": eid, "created": created, "file": fn}
                for (eid, created), fn in zip(out, files, strict=True)
            ]
        return result

    # --- 改 ROI / 追加区域（v2.0） ------------------------------------------------

    def _crop_for(self, image_ref: str, sha: str, roi: Roi) -> tuple[Roi, str]:
        """返回 ``(收进边界的 roi, crop_ref)``。

        整图 ROI 不另存裁剪图（``crop_ref`` 空，§7.8 第 2 条）。
        """
        with Image.open(self.images.abs_path(image_ref)) as im:
            size = im.size
        try:
            clamped = clamp_roi(roi, size)
        except ValueError as exc:
            raise AtlasError("BAD_ROI", str(exc)) from exc
        if clamped == _whole(size):
            return clamped, ""
        return clamped, self.images.save_crop(image_ref, sha, clamped)

    def set_roi(self, exemplar_id: str, roi: Roi):
        """改 ROI：重裁、描述回到 ``pending``、置已确认（§7.8 第 5 条）。"""
        cur = self.store.get(exemplar_id)
        if cur is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        clamped, crop_ref = self._crop_for(cur.image_ref, cur.image_sha256, roi)
        changes: dict[str, Any] = {"roi": clamped, "crop_ref": crop_ref}
        if clamped != tuple(cur.roi):
            changes["describe_status"] = "pending"
        return self.store.update(exemplar_id, changes)

    def add_region(self, exemplar_id: str, roi: Roi) -> dict[str, Any]:
        """同一原图追加一条案例（§7.8 第 6 条）。

        继承来源、图册、外发许可与标签初值，``reviewed=True``。
        """
        cur = self.store.get(exemplar_id)
        if cur is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        clamped, crop_ref = self._crop_for(cur.image_ref, cur.image_sha256, roi)
        [(eid, created)] = self.store.create(
            [
                NewExemplar(
                    image_ref=cur.image_ref,
                    image_sha256=cur.image_sha256,
                    roi=clamped,
                    tags=cur.tags_raw,
                    source_type=cur.source_type,  # type: ignore[arg-type]
                    source=cur.source,
                    import_batch_id=uuid.uuid4().hex,
                    crop_ref=crop_ref or None,
                    egress=cur.egress,  # type: ignore[arg-type]
                    egress_consent=cur.egress_consent,
                    collection=cur.collection,
                    reviewed=True,
                )
            ]
        )
        return {"exemplar_id": eid, "created": created}

    def migrate_legacy_rois(self) -> int:
        """v1 → v2.0 一次性迁移（SDD 03 §9 ``roi``）：v1 向导把 ROI 存成 ``x0,y0,x1,y1``，
        换算为 ``x,y,w,h`` 并重建裁剪图；幂等键、描述与确认状态不变。返回迁移条数。
        """
        n = 0
        for ex in self.store.list(status=None, limit=1_000_000):
            if ex.source_type not in LEGACY_XYXY_SOURCES:
                continue
            x0, y0, x1, y1 = (int(v) for v in ex.roi)
            if x1 <= x0 or y1 <= y0:
                continue
            try:
                clamped, crop_ref = self._crop_for(
                    ex.image_ref, ex.image_sha256, (x0, y0, x1 - x0, y1 - y0)
                )
            except (AtlasError, FileNotFoundError) as exc:
                log.warning("Atlas ROI 迁移跳过 %s：%s", ex.exemplar_id, exc)
                continue
            self.store.update(ex.exemplar_id, {"roi": clamped, "crop_ref": crop_ref}, review=False)
            n += 1
        if n:
            log.info("Atlas v1 ROI 迁移：%d 条由 x0,y0,x1,y1 换算为 x,y,w,h", n)
        return n

    # --- 创建（CLI / POST /exemplars） --------------------------------------------

    def create(
        self, inputs: Sequence[ExemplarInput], *, import_batch_id: str | None = None
    ) -> list[dict[str, Any]]:
        """返回 ``[{exemplar_id, created}]``（顺序对应输入）。

        任一条校验失败整批不写（先校验后落盘）。
        """
        batch = import_batch_id or uuid.uuid4().hex
        prepared: list[NewExemplar] = []
        for i, inp in enumerate(inputs):
            png = self._resolve_png(inp, i)
            image_ref, sha, _size = self.images.save_original(png)
            try:
                crop_ref = self.images.save_crop(image_ref, sha, inp.roi)
            except ValueError as exc:
                raise AtlasError("BAD_ROI", f"第 {i} 项：{exc}") from exc
            prepared.append(
                NewExemplar(
                    image_ref=image_ref,
                    image_sha256=sha,
                    roi=tuple(int(v) for v in inp.roi),  # type: ignore[arg-type]
                    tags=inp.tags,
                    source_type=inp.source_type,  # type: ignore[arg-type]
                    source=inp.source,
                    import_batch_id=batch,
                    crop_ref=crop_ref,
                    geometry=inp.geometry,
                    caption=inp.caption,
                    notes=inp.notes,
                    describe_status="pending",
                    egress=inp.egress,  # type: ignore[arg-type]
                    egress_consent=inp.egress_consent,
                    collection=inp.collection,
                    reviewed=inp.reviewed,
                )
            )
        results = self.store.create(prepared)
        self.store.optimize()
        return [{"exemplar_id": eid, "created": created} for eid, created in results]

    def _resolve_png(self, inp: ExemplarInput, i: int) -> bytes:
        if inp.image_base64:
            try:
                return base64.b64decode(inp.image_base64, validate=True)
            except Exception as exc:  # noqa: BLE001
                raise AtlasError("BAD_IMAGE", f"第 {i} 项：image_base64 无法解码") from exc
        raise AtlasError("BAD_IMAGE", f"第 {i} 项：需提供 image_base64")
