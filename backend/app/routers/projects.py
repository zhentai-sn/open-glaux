"""``/projects`` 项目登记与按需识别（SDD 13 §6.3、§7.1、§7.2、§9.1）。

项目 = 本机一个目录；登记不扫描目录、不登记数据源（§7.2 规则 1）。文件被打开时才按「目录 + 模态」
登记数据源（``POST /projects/{id}/objects``）。整个 router 只接受回环来源（§7.1 规则 3）。
错误语义：非回环或目录不可读 403；不存在 404；非目录或写法无法转换 422。移除前「无运行中会话」
的检查由前端完成（D-16）。

``entries`` / ``objects`` 两个端点的错误体为 ``{"detail": {"code", "message"}}``
（与 ``/atlas`` 同形），``code`` 供前端与 agent-runtime 工具机读：``project_not_found``、
``not_found``、``outside_project``、``not_directory``、``not_file``、``unsupported_format``、
``corrupt``。
"""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .. import datasource_registry as dsreg
from ..schemas import (
    ObjectMeta,
    ProjectCreateRequest,
    ProjectEntries,
    ProjectEntry,
    ProjectObjectRequest,
    ProjectView,
)
from ..sources import SOURCES
from ..sources.base import Source, suffix_matches, supports_object_id_for
from .loopback import require_loopback
from .objects import resolve as resolve_object_meta

router = APIRouter(
    prefix="/projects", tags=["projects"], dependencies=[Depends(require_loopback)]
)

_HTTP_BY_CODE = {
    "project_not_found": 404,
    "not_found": 404,
    "outside_project": 422,
    "not_directory": 422,
    "not_file": 422,
    "unsupported_format": 422,
    "corrupt": 422,
}


def _err(code: str, msg: str) -> HTTPException:
    return HTTPException(_HTTP_BY_CODE[code], {"code": code, "message": msg})


@router.get("", response_model=list[ProjectView])
def projects_list() -> list[ProjectView]:
    """已登记项目；``status`` 实时判定（目录被删除或不可读 → ``missing``）。"""
    return [ProjectView(**p.info()) for p in dsreg.list_projects()]


@router.post("", response_model=ProjectView, status_code=201)
def projects_create(req: ProjectCreateRequest, response: Response) -> ProjectView:
    """登记一个目录为项目。新建 201；同一规范化路径已登记 → 200 返回原项目（幂等）。"""
    try:
        prj, created = dsreg.register_project(req.path)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if not created:
        response.status_code = 200
    return ProjectView(**prj.info())


@router.delete("/{project_id}", status_code=204)
def projects_remove(project_id: str) -> Response:
    """注销项目及其数据源；不删除磁盘文件、不删除会话（§7.1 规则 6）。"""
    if not dsreg.remove_project(project_id):
        raise HTTPException(404, f"项目不存在：{project_id}")
    return Response(status_code=204)


# --- 按需识别（§7.2）------------------------------------------------------------


def _project(project_id: str) -> dsreg.Project:
    prj = dsreg.get_project(project_id)
    if prj is None:
        raise _err("project_not_found", f"项目不存在：{project_id}")
    return prj


def _inside(prj: dsreg.Project, rel: str) -> Path:
    """项目内相对路径 → 解析后的绝对路径。

    含 ``..``、是绝对路径或解析后越出项目根 → ``outside_project``。

    解析会跟随符号链接，故指向项目根以外的链接同样被拒（§7.2 规则 9）。不校验存在性。
    """
    pure = PurePosixPath(rel)
    if pure.is_absolute() or ".." in pure.parts:
        raise _err("outside_project", f"路径不在项目内：{rel}")
    root = prj.path.resolve()
    try:
        target = (root / pure).resolve()
    except (OSError, RuntimeError) as e:  # 符号链接成环等
        raise _err("outside_project", f"路径无法解析：{rel}（{e}）") from e
    if not target.is_relative_to(root):
        raise _err("outside_project", f"路径不在项目内：{rel}")
    return target


def _candidates(name: str) -> list[Source]:
    """按后缀命中 ``formats`` 的 Source，按 ``SOURCES`` 声明顺序（§7.2 规则 2、5）。不读内容。"""
    return [src for src in SOURCES.values() if suffix_matches(src.formats, name)]


def _registered_object_id(
    owned: dict[str, dsreg.DataSource], path: Path, src: Source
) -> str | None:
    """文件所在目录已按该模态登记时，按 ``derive_id`` 纯派生回填对象 id；未登记为 None。

    不读文件内容（§7.2 规则 2）：不校验魔数、不探测，故只是提示值——文件可能已损坏，真正打开仍走
    ``POST /projects/{id}/objects`` 的完整校验。``owned`` 是本项目已登记的数据源（id → 条目），
    每次列目录取一次。
    """
    ds = owned.get(dsreg.project_source_id(path.parent, src.modality))
    if ds is None or not supports_object_id_for(src):
        return None
    try:
        return src.derive_id(ds, path.name)  # type: ignore[attr-defined]
    except (AttributeError, NotImplementedError):
        return None


@router.get("/{project_id}/entries", response_model=ProjectEntries)
def projects_entries(
    project_id: str,
    path: str = Query("", description="项目内相对路径（POSIX 分隔），缺省为项目根"),
) -> ProjectEntries:
    """列出项目内一个目录的一层条目（§7.2 规则 2、8）。

    跳过 ``.`` 开头的条目；符号链接解析后落在项目根以外的不列；解析不到目录或文件的（断链）不列。
    文件的 ``modality`` 只按后缀给候选值；所在目录已按该模态登记时回填 ``object_id``。
    目录在前、名称不区分大小写升序；不截断（截断是 agent 工具的事，§7.3 规则 2）。
    """
    prj = _project(project_id)
    target = _inside(prj, path)
    root = prj.path.resolve()
    if not target.exists():
        raise _err("not_found", f"路径不存在：{path}")
    if not target.is_dir():
        raise _err("not_directory", f"路径不是目录：{path}")
    rel_dir = target.relative_to(root)
    owned = {s.id: s for s in dsreg.list_all() if s.project_id == prj.id}
    entries: list[ProjectEntry] = []
    try:
        with os.scandir(target) as it:
            names = [e.name for e in it if not e.name.startswith(".")]
    except PermissionError as e:
        raise HTTPException(403, f"无读权限：{path}") from e
    for name in names:
        try:
            real = (target / name).resolve()
            if not real.is_relative_to(root):
                continue
            is_dir, is_file = real.is_dir(), real.is_file()
        except (OSError, RuntimeError):
            continue
        rel = (PurePosixPath(rel_dir.as_posix()) / name).as_posix()
        if is_dir:
            entries.append(ProjectEntry(name=name, path=rel, type="dir"))
        elif is_file:
            cands = _candidates(name)
            modality = cands[0].modality if cands else None
            oid = None
            for src in cands:  # 同后缀多模态时，以已登记者为准（§7.2 规则 5）
                oid = _registered_object_id(owned, real, src)
                if oid is not None:
                    modality = src.modality
                    break
            entries.append(
                ProjectEntry(name=name, path=rel, type="file", modality=modality, object_id=oid)
            )
    entries.sort(key=lambda e: (e.type != "dir", e.name.casefold(), e.name))
    shown = "" if rel_dir == Path(".") else rel_dir.as_posix()
    return ProjectEntries(path=shown, entries=entries, total=len(entries))


@router.post("/{project_id}/objects", response_model=ObjectMeta)
def projects_open_object(project_id: str, req: ProjectObjectRequest) -> ObjectMeta:
    """按需打开项目内一个文件，返回其 ``ObjectMeta``（§6.3、§7.2 规则 3–5、§10）。

    后缀无候选、或候选 Source 都不参与按需识别（P1 的 CT、WSI）→ ``unsupported_format``；
    候选都校验不过（魔数不符、无法解码）→ ``corrupt``。同后缀多个候选按 ``SOURCES`` 声明顺序取
    第一个校验通过者。校验先用未登记的源草稿做，通过后才登记，损坏文件不留数据源。
    同一文件重复打开得到同一对象 id，不重复登记（数据源 id 由目录与模态派生）。
    """
    prj = _project(project_id)
    target = _inside(prj, req.path)
    if not target.exists():
        raise _err("not_found", f"文件不存在：{req.path}")
    if not target.is_file():
        raise _err("not_file", f"路径不是文件：{req.path}")
    usable = [src for src in _candidates(target.name) if supports_object_id_for(src)]
    if not usable:
        raise _err("unsupported_format", f"不支持的文件格式：{target.name}")
    for src in usable:
        spec = dsreg.project_source_spec(prj, target.parent, src.modality)
        oid = src.object_id_for(spec, target)
        if oid is None:
            continue
        # 草稿与正式条目的 id 同由 (目录, 模态) 派生，对象 id 只依赖源 id 与文件名，故无需重算
        dsreg.ensure_project_source(prj, target.parent, src.modality)
        _ref, obj = resolve_object_meta(oid)
        return obj
    raise _err("corrupt", f"文件内容与后缀不符或无法解码：{target.name}")
