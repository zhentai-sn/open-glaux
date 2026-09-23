"""浏览器文件上传（SDD 08 §5.1 / §6.2 / §13；受理表见 SDD 10 §4.1）。

只做「取字节 → 交给 upload_store 判定 → 落盘 → 注册数据源」，命名与校验规则全在
:mod:`app.upload_store`。落盘目录必经 :func:`datasource_registry.register_folder`，
使「路径必须在 datasets_root 下」只有一处实现，不在这里另写一遍白名单校验。
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import config, upload_store
from .. import datasource_registry as reg
from ..schemas import DataSourceInfo, UploadAccepted, UploadRejected, UploadResult
from ..sources import SOURCES

router = APIRouter(prefix="/uploads", tags=["uploads"])

_CHUNK = 1 << 20  # 1 MiB


def _default_name() -> str:
    return "上传 · " + _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@router.post("/images", response_model=UploadResult)
async def upload_images(
    files: list[UploadFile] = File(...),
    name: str | None = Form(default=None),
) -> UploadResult:
    """把一批文件写入 ``uploads/`` 下的一个数据源。

    模态由受理表推断（``SOURCES[*].formats`` 的后缀与魔数，SDD 10 §4.1），不接受客户端指定
    （SDD 08 D-2）。一批只落一个数据源：模态取第一个受理文件的模态，其余模态的文件按
    ``unsupported_type`` 拒收；同名数据源已存在时沿用其模态——同一目录不能换模态注册。
    医学数据仍走「服务端文件夹路径」导入（D-5）。
    """
    if not files:
        raise HTTPException(422, "未收到文件")
    if len(files) > config.UPLOAD_MAX_FILES:
        # 整体拒绝且不落盘：越限时先写一半再报错，会留下半个数据源，比直接拒更难收拾
        raise HTTPException(422, f"单次最多上传 {config.UPLOAD_MAX_FILES} 个文件")

    source_name = (name or "").strip() or _default_name()
    target = upload_store.source_dir(source_name)
    existing = next((s for s in reg.list_all() if s.root == target.resolve()), None)
    modality = existing.modality if existing is not None else None

    rejected: list[UploadRejected] = []
    stored: list[tuple[Path, str, int]] = []  # (落盘路径, 原始文件名, 字节数)
    made_dir = not target.exists()
    target.mkdir(parents=True, exist_ok=True)

    try:
        for f in files:
            filename = f.filename or "unnamed"
            head = await f.read(upload_store.magic_prefix_len())
            body = bytearray(head)
            while True:
                chunk = await f.read(_CHUNK)
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > config.UPLOAD_MAX_BYTES:
                    break  # 超限即停读，不把超大文件整个吃进内存

            verdict, detail = upload_store.classify(filename, bytes(head), len(body))
            file_modality = upload_store.modality_of(filename)
            if verdict == "accept" and modality is not None and file_modality != modality:
                verdict, detail = "reject", upload_store.REASON_UNSUPPORTED
            if verdict == "reject":
                rejected.append(UploadRejected(filename=filename, reason=detail))  # type: ignore[arg-type]
                continue
            modality = file_modality

            path = target / upload_store.store_name(filename, detail)
            path.write_bytes(bytes(body))  # 同名重传覆盖同一文件 → ID 不变（§10）
            stored.append((path, filename, len(body)))
    except OSError as e:
        raise HTTPException(500, f"写入失败：{e}") from e

    if not stored:
        # 全部被拒：不创建数据源，也不留下空目录（§13）
        if made_dir and not any(target.iterdir()):
            target.rmdir()
        raise HTTPException(422, "没有可受理的图像文件")

    # ID 依赖注册后才确定的 source_id，故先注册再派生（§9.3）
    from .. import datasource_detect

    src = reg.register_folder(
        target, modality, name=source_name, detect=datasource_detect.detect
    )
    derive = SOURCES[modality].derive_id
    accepted = [
        UploadAccepted(id=derive(src, path.name), filename=filename, bytes=n)
        for path, filename, n in stored
    ]
    return UploadResult(source=DataSourceInfo(**src.info()), accepted=accepted, rejected=rejected)
