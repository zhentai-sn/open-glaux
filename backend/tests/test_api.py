"""F4/F5–F9 端点测试：契约形状 + 真实数据接入 + 主进程无 TF / 无 LLM SDK。

数据可用时测真实接入；不可用时测 mock 回退——两条路径的契约形状一致。
"""

import importlib.util
import sys
from importlib.metadata import version

import pytest
from fastapi.testclient import TestClient

from app import __version__, config
from app.main import app

client = TestClient(app)
HAS_DATA = config.data_available()
HAS_HC_DATA = config.hc_data_available()  # HC18 真实数据就绪 → 真图真模型；否则合成回退


def _a_demo_id() -> str:
    if HAS_DATA:
        from app import dataset

        return dataset.list_ids()[0]
    return "tech_437"


# --- 契约不变量（两条路径都成立） ------------------------------------------

def test_health_no_tf_in_process():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["tf_in_process"] is False
    assert r.json()["version"] == __version__ == version("glaux-backend")


def test_no_tf_importable_in_main_process():
    # 硬要求：TF 只在 caroSegDeep 隔离子进程，主进程绝不引入。
    assert importlib.util.find_spec("tensorflow") is None


def test_intent_endpoints_retired():
    """意图层已退役（2026-08-16）：/interpret 与 /intent/* 不再存在——NL 由 agent-runtime 处理。"""
    assert client.post("/interpret", json={"nl": "测远壁颈动脉 IMT"}).status_code == 404
    assert client.get("/intent/backends").status_code == 404
    assert client.post("/intent/vlm/test", json={"provider": "anthropic"}).status_code == 404


def test_no_llm_sdk_loaded_in_main_process():
    """不变量：只有 agent-runtime 与模型说话；backend 主进程不加载任何 LLM SDK / 意图层。"""
    # 只查"已加载"而非"可安装"——旧 venv 可能残留 anthropic 包，但主进程绝不能 import 它。
    assert "anthropic" not in sys.modules
    assert "glaux_orchestrator" not in sys.modules


def test_tasks_registry_exposed():
    """GET /tasks 下发多模态注册表——前端渲染模态/工具/度量的单一真相源。"""
    r = client.get("/tasks")
    assert r.status_code == 200
    by_id = {v["task"]: v for v in r.json()}
    assert {"far_wall_cca_imt", "fetal_hc"} <= set(by_id)
    imt = by_id["far_wall_cca_imt"]
    assert imt["viewer"] == "raster_2d" and imt["adapter_kind"] == "wall_pair"
    assert imt["modality"] == "carotid_imt" and by_id["fetal_hc"]["modality"] == "fetal_hc"
    assert any(m["key"] == "IMT_mean" for m in imt["metrics"])
    assert {t["id"] for t in imt["tools"]} >= {"cursor", "bbox", "polygon", "wall", "brush"}
    # SDD 04 能力位下发；SDD 10 起为开放集，故断言「至少含」而非逐项相等
    assert set(imt["capabilities"]) >= {"bbox", "polygon", "brush", "wall"}
    assert imt["overlays"][0]["role"] == "LI"
    hc = by_id["fetal_hc"]
    assert hc["adapter_kind"] == "contour"
    assert any(m["key"] == "HC" for m in hc["metrics"])


def test_every_task_row_contract():
    """逐行校验 /tasks：模态已注册、有几何族与度量，task 不重复——新任务行自动纳入。"""
    from app import datasource_registry as reg

    rows = client.get("/tasks").json()
    assert rows
    assert len({r["task"] for r in rows}) == len(rows)
    for r in rows:
        assert r["modality"] in reg.MODALITIES, r["task"]
        assert r["adapter_kind"], r["task"]
        assert r["metrics"] and all(m["key"] and m["unit"] for m in r["metrics"]), r["task"]
        assert {t["id"] for t in r["tools"]} >= {"cursor"}, r["task"]


def test_capabilities_registry_four_layers():
    """GET /capabilities 下发能力清单：按环境四要素分层，含真实 skill/model/dataset 与占位卡。"""
    r = client.get("/capabilities")
    assert r.status_code == 200
    caps = r.json()
    layers = {c["layer"] for c in caps}
    assert {"representation", "action", "verification", "memory"} <= layers
    kinds = {c["kind"] for c in caps}
    # skill = TaskPlugin：两个任务各一张 skill 卡（动作空间）
    ids = {c["id"] for c in caps}
    assert {"skill:far_wall_cca_imt", "skill:fetal_hc"} <= ids
    assert all(c["layer"] == "action" for c in caps if c["kind"] == "skill")
    # 真实 model（caroSegDeep，动作空间）
    assert any(
        c["id"] == "caroSegDeep" and c["kind"] == "model" and c["layer"] == "action"
        for c in caps
    )
    # dataset（观测空间）
    assert any(c["kind"] == "dataset" and c["layer"] == "representation" for c in caps)
    # 有类型占位卡（planned）：connector/mcp/knowledge_base
    assert any(c["status"] == "planned" for c in caps)
    assert {"connector", "mcp", "knowledge_base"} <= kinds


def test_images_and_models_shape():
    """列表契约：显式传模态，每条都属该模态且 id 可取图；模型清单含颈动脉的 caroSegDeep。

    不断言 `center`（楔子期字段，SDD 10 D-8 降为可选 meta.center），也不依赖清单顺序。
    """
    from app import datasource_registry as reg

    imgs = client.get("/images", params={"modality": "carotid_imt"}).json()
    assert len(imgs) > 0
    assert all(m["id"] and m["modality"] == "carotid_imt" for m in imgs)
    assert client.get(f"/image/{imgs[0]['id']}").status_code == 200
    models = client.get("/models").json()
    assert all(m["modality"] in reg.MODALITIES for m in models)
    assert any(
        m["id"] == "caroSegDeep" and m["active"] and m["modality"] == "carotid_imt"
        for m in models
    )


def test_image_returns_png():
    r = client.get(f"/image/{_a_demo_id()}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# --- 真实数据接入专项（无数据环境跳过） -------------------------------------

def test_real_dataset_cohort():
    if not HAS_DATA:
        return
    imgs = client.get("/images", params={"modality": "carotid_imt"}).json()
    assert len(imgs) == 100  # tech_401–500 演示队列
    assert all(m["cf"] and m["cf"] > 0 for m in imgs)
    assert "caroSegDeep" in imgs[0]["methods"]


def test_real_segment_caro_and_reference():
    """segment_proc 直取：caroSegDeep（隔离子进程/缓存）+ 参考方法都出稠密边界。

    （端点已收口到 /task/run；此处直测取数层 segment_proc，保真实子进程/参考方法覆盖。）
    """
    if not HAS_DATA:
        return
    from app import segment_proc

    i = _a_demo_id()
    caro_li, _caro_ma, caro_mv = segment_proc.segment(i, "caroSegDeep")
    assert len(caro_li) > 100 and "caroSegDeep" in caro_mv
    ref_li, _ref_ma, ref_mv = segment_proc.segment(i, "GT-FAMUS")
    assert len(ref_li) > 100 and "reference" in ref_mv


# --- 第二模态：胎儿头围（HC）------------------------------------------------
# HC18 真实数据就绪时测真图 + CSM 真模型；否则测合成回退。两条路径契约形状一致。

def _an_hc_id() -> str:
    """一个可用（真实优先且已缓存）的 HC image_id。"""
    if HAS_HC_DATA:
        from app import hc_dataset

        ids = hc_dataset.list_ids()
        # 优先取已有预测缓存的图，避免测试触发隔离子进程现算。
        for i in ids:
            if (config.HC_SEG_CACHE / f"{i}-contour.txt").is_file():
                return i
        return ids[0]
    return "hc_004"


def test_hc_images_modality_tagged():
    imgs = client.get("/images", params={"modality": "fetal_hc"}).json()
    assert all(m["modality"] == "fetal_hc" and m["cf"] > 0 for m in imgs)
    if HAS_HC_DATA:
        assert len(imgs) == 999 and not imgs[0]["id"].startswith("hc_")  # 真实 HC18
    else:
        assert len(imgs) == 10 and imgs[0]["id"].startswith("hc_")  # 合成回退


def test_hc_image_returns_png():
    r = client.get(f"/image/{_an_hc_id()}")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_hc_task_measure_roundtrips_from_run_primitives():
    """由 /task/run 输出的椭圆图元重测头围应一致量级（编辑回流一致性）。"""
    run = client.post("/task/run", json={"task": "fetal_hc", "image_id": _an_hc_id()}).json()
    m = client.post(
        "/task/measure",
        json={"task": "fetal_hc", "primitives": run["primitives"], "cf": run["calibration"]["cf"]},
    ).json()
    assert abs(m["metrics"]["HC"]["value"] - run["metrics"]["HC"]["value"]) < 2.0


def test_task_run_rejects_non_hc_id():
    """HC 任务喂颈动脉图 id → 硬拒绝（422，不在错模态上瞎跑）。"""
    r = client.post("/task/run", json={"task": "fetal_hc", "image_id": "tech_401"})
    assert r.status_code == 422


def test_models_include_both_modalities():
    ids = {m["id"]: m for m in client.get("/models").json()}
    hc_method = "CSM" if HAS_HC_DATA else "ellipse-fit"  # 真实用 CSM，合成用亮环椭圆
    assert hc_method in ids and ids[hc_method]["modality"] == "fetal_hc"


# --- 统一驱动端点（P2.0：/task/run · /task/detect · /task/measure，多模态通吃） --

def test_task_run_unified_imt_shape():
    r = client.post("/task/run", json={"task": "far_wall_cca_imt", "image_id": _a_demo_id()})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["task"] == "far_wall_cca_imt"
    assert out["metrics"]["IMT_mean"]["unit"] == "mm"
    assert 0.3 < out["metrics"]["IMT_mean"]["value"] < 2.0  # 生理区间（真实/mock 都成立）
    roles = [p["role"] for p in out["primitives"] if p["kind"] == "polyline"]
    assert "LI" in roles and "MA" in roles
    assert out["calibration"]["cf"] > 0 and out["calibration"]["source"] == "cubs"


def test_task_run_unified_hc_shape():
    r = client.post("/task/run", json={"task": "fetal_hc", "image_id": _an_hc_id()})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["task"] == "fetal_hc"
    assert "HC" in out["metrics"]
    assert 30 < out["metrics"]["HC"]["value"] < 350  # 生理量级（HC18 ~44–324mm）
    assert out["metrics"]["OFD"]["value"] > out["metrics"]["BPD"]["value"]  # 长轴 > 短轴
    assert out["metrics"]["vs_GT"]["value"] < 10.0  # 贴近参考（真模型端到端 MAE≈1mm，留裕度）
    assert any(p["kind"] == "ellipse" for p in out["primitives"])


def test_task_measure_reflows_from_edited_primitives():
    prims = [
        {"kind": "polyline", "id": "LI", "role": "LI",
         "points": [[0, 100], [10, 100], [20, 100]], "closed": False},
        {"kind": "polyline", "id": "MA", "role": "MA",
         "points": [[0, 116.4], [10, 116.4], [20, 116.4]], "closed": False},
    ]
    r = client.post("/task/measure",
                    json={"task": "far_wall_cca_imt", "primitives": prims, "cf": 0.0559})
    assert r.status_code == 200, r.text
    assert 0.8 < r.json()["metrics"]["IMT_mean"]["value"] < 1.0  # 16.4px × 0.0559 ≈ 0.917


def test_task_run_hard_rejects_without_calibration():
    if not HAS_DATA:
        return  # 无数据时 wall_pair 走 mock（无需 image_id），不触发硬拒绝
    assert client.post("/task/run", json={"task": "far_wall_cca_imt"}).status_code == 422


# --- 回归：SDD 10 收敛前的已知缺陷（xfail(strict)，对应波次转绿即须摘标记） ----------
# 「未知 id → 404」已在 W1 转绿（resolve_object，无 mock 回退，D-17）。


def test_image_unknown_ct_id_404_without_cubs_data(tmp_path, monkeypatch):
    """未知 CT id 必须 404，不能在无 CUBS 数据时被 mock 合成颈动脉图吞掉（DEBT-02/DEBT-28）。

    id 用一个不存在的 ct_999：W1 后 /image/{id} 对既有 CT 可能返回首帧，只有「未知 id」的
    语义在收敛前后不变。
    """
    from app import dataset_ct

    monkeypatch.setattr(config, "data_available", lambda: False)  # 无 CUBS 数据
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)  # 空 CT 根：ct_999 不存在
    dataset_ct._load_nifti.cache_clear()
    assert client.get("/image/ct_999").status_code == 404


def _seed_ct(tmp_path, monkeypatch, vox=(0.5, 0.5, 2.0)):
    """造 ct_001 体积 + 缓存 labelmap（肝 1 = 2×2×2 体素），供 /task/run 走缓存命中。"""
    import nibabel as nib
    import numpy as np

    from app import dataset_ct

    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    (tmp_path / "ct").mkdir()
    (tmp_path / "cache").mkdir()
    ct = nib.Nifti1Image(np.full((4, 4, 4), 50.0, dtype=np.float32), np.eye(4))
    ct.header.set_zooms(vox)
    nib.save(ct, str(tmp_path / "ct" / "ct_001.nii.gz"))
    lbl = np.zeros((4, 4, 4), dtype=np.int32)
    lbl[0:2, 0:2, 0:2] = 1
    lm = nib.Nifti1Image(lbl, np.eye(4))
    lm.header.set_zooms(vox)
    nib.save(lm, str(tmp_path / "cache" / "ct_001_totalsegmentator_v2.nii.gz"))
    dataset_ct._load_nifti.cache_clear()


def test_task_run_ct_returns_voxel_calibration(tmp_path, monkeypatch):
    """前置事实（今天即绿）：CT 的 /task/run 出体掩膜，体积 = 体素数 × voxel 体积。

    与下一条 xfail 分开，保证那条只会因 /task/measure 而失败。
    """
    _seed_ct(tmp_path, monkeypatch)
    r = client.post("/task/run", json={"task": "totalseg_liver_kidney", "image_id": "ct_001"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert any(p["kind"] == "volume_mask" for p in out["primitives"])
    assert out["metrics"]["liver_volume_mm3"]["value"] == 8 * 0.5 * 0.5 * 2.0


@pytest.mark.xfail(
    strict=True,
    reason="turns green in W2 (calibration dispatch, SDD 10 D-16)；"
    "现状 TaskMeasureRequest 只收 cf: float，缺 cf 即 422",
)
def test_task_measure_ct_with_voxel_calibration(tmp_path, monkeypatch):
    """/task/measure 携 voxel 标定重测 CT 体掩膜应成功，且与 /task/run 同值（SDD 10 §15.1 C）。"""
    _seed_ct(tmp_path, monkeypatch)
    run = client.post(
        "/task/run", json={"task": "totalseg_liver_kidney", "image_id": "ct_001"}
    ).json()
    m = client.post(
        "/task/measure",
        json={
            "task": "totalseg_liver_kidney",
            "primitives": run["primitives"],
            "calibration": {"kind": "voxel_mm", "value": [0.5, 0.5, 2.0], "source": "nifti_header"},
        },
    )
    assert m.status_code == 200, m.text
    got = m.json()["metrics"]["liver_volume_mm3"]["value"]
    assert got == run["metrics"]["liver_volume_mm3"]["value"]
