"""F4/F5–F9 端点测试：契约形状 + 三态守卫 + 真实数据接入 + 主进程无 TF。

数据可用时测真实接入；不可用时测 mock 回退——两条路径的契约形状一致。
"""

import importlib.util

from fastapi.testclient import TestClient

from app import config
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


def test_no_tf_importable_in_main_process():
    # 硬要求：TF 只在 caroSegDeep 隔离子进程，主进程绝不引入。
    assert importlib.util.find_spec("tensorflow") is None


def test_interpret_three_states():
    assert client.post("/interpret", json={"nl": "测远壁颈动脉 IMT"}).json()["scope"] == "in_scope"
    assert client.post("/interpret", json={"nl": "分析一下这张图"}).json()["scope"] == "ambiguous"
    assert client.post("/interpret", json={"nl": "计算左心室射血分数"}).json()["scope"] == "out_of_scope"


def test_interpret_non_in_scope_has_no_spec():
    r = client.post("/interpret", json={"nl": "分割乳腺肿瘤"}).json()
    assert r["scope"] == "out_of_scope" and r["spec"] is None


def test_tasks_registry_exposed():
    """GET /tasks 下发多模态注册表——前端渲染模态/工具/度量的单一真相源。"""
    r = client.get("/tasks")
    assert r.status_code == 200
    by_id = {v["task"]: v for v in r.json()}
    assert {"far_wall_cca_imt", "fetal_hc"} <= set(by_id)
    imt = by_id["far_wall_cca_imt"]
    assert imt["viewer"] == "raster_2d" and imt["adapter_kind"] == "wall_pair"
    assert any(m["key"] == "IMT_mean" for m in imt["metrics"])
    assert {t["id"] for t in imt["tools"]} >= {"cursor", "edit_li", "edit_ma"}
    assert imt["overlays"][0]["role"] == "LI"
    hc = by_id["fetal_hc"]
    assert hc["adapter_kind"] == "contour"
    assert any(m["key"] == "HC" for m in hc["metrics"])


def test_measure_matches_imtresult_shape():
    li = [[0, 100], [10, 100], [20, 100]]
    ma = [[0, 116.4], [10, 116.4], [20, 116.4]]
    r = client.post("/measure", json={"li": li, "ma": ma, "cf": 0.0559}).json()
    assert set(r) == {"mean_mm", "max_mm", "pdm_mean_mm", "per_column_um", "n_columns"}
    assert 0.8 < r["mean_mm"] < 1.0  # 16.4px × 0.0559 ≈ 0.917mm


def test_images_and_models_shape():
    imgs = client.get("/images").json()
    assert len(imgs) > 0 and imgs[0]["center"] == "CUBS-tech"
    models = client.get("/models").json()
    assert models[0]["id"] == "caroSegDeep" and models[0]["active"]


def test_image_returns_png():
    r = client.get(f"/image/{_a_demo_id()}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_run_returns_physiological_imt():
    r = client.post("/run", json={"task": "far_wall_cca_imt", "image_id": _a_demo_id()}).json()
    assert r["cf_source"] == "cubs"
    assert 0.3 < r["mean_mm"] < 2.0  # 真实/mock 都落生理区间
    assert r["n_columns"] > 0


def test_correction_provenance():
    corr = client.post(
        "/correction",
        json={"image_id": "tech_437", "which": "MA", "points": [[0, 1]], "imt": 0.92},
    ).json()
    assert corr["ok"] and corr["provenance"]["source"] == "human"


# --- 真实数据接入专项（无数据环境跳过） -------------------------------------

def test_real_dataset_cohort():
    if not HAS_DATA:
        return
    imgs = client.get("/images").json()
    assert len(imgs) == 100  # tech_401–500 演示队列
    assert all(m["cf"] and m["cf"] > 0 for m in imgs)
    assert "caroSegDeep" in imgs[0]["methods"]


def test_real_segment_caro_and_reference():
    if not HAS_DATA:
        return
    i = _a_demo_id()
    caro = client.post("/segment", json={"image_id": i, "model": "caroSegDeep"}).json()
    assert len(caro["li"]) > 100 and "caroSegDeep" in caro["model_version"]
    ref = client.post("/segment", json={"image_id": i, "model": "GT-FAMUS"}).json()
    assert len(ref["li"]) > 100 and "reference" in ref["model_version"]


def test_real_run_hard_rejects_without_cf():
    if not HAS_DATA:
        return
    # 缺 image_id → 无法标定 → 硬拒绝（422，不出假 IMT）
    r = client.post("/run", json={"task": "far_wall_cca_imt"})
    assert r.status_code == 422


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


def test_hc_run_detects_near_ground_truth():
    r = client.post("/hc/run", json={"image_id": _an_hc_id()}).json()
    assert 30 < r["hc_mm"] < 350  # 生理量级（真实 HC18 覆盖 ~44–324mm）
    assert r["ofd_mm"] > r["bpd_mm"]  # 枕额径（长轴）> 双顶径（短轴）
    # 真检测/合成检测都应贴近参考（真实模型端到端 MAE≈1mm，留裕度）
    assert r["vs_gt_mm"] is not None and r["vs_gt_mm"] < 10.0
    assert len(r["contour"]) >= 5 and "ellipse" in r


def test_hc_measure_from_contour_roundtrips():
    run = client.post("/hc/run", json={"image_id": _an_hc_id()}).json()
    m = client.post("/hc/measure", json={"points": run["contour"], "cf": run["cf"]}).json()
    assert abs(m["hc_mm"] - run["hc_mm"]) < 2.0  # 由检测轮廓重测应一致量级


def test_hc_run_rejects_non_hc_id():
    assert client.post("/hc/run", json={"image_id": "tech_401"}).status_code == 422


def test_hc_intent_routes_to_fetal_task():
    r = client.post("/interpret", json={"nl": "测这张胎儿颅脑图的头围"}).json()
    assert r["scope"] == "in_scope" and r["spec"]["task"] == "fetal_hc"


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
    assert out["metrics"]["OFD"]["value"] > out["metrics"]["BPD"]["value"]  # 长轴 > 短轴
    assert any(p["kind"] == "ellipse" for p in out["primitives"])


def test_task_detect_returns_primitives_only():
    r = client.post("/task/detect", json={"task": "fetal_hc", "image_id": _an_hc_id()})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["model_version"] and any(p["kind"] == "ellipse" for p in d["primitives"])
    assert "metrics" not in d  # detect 只出几何，不测量


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
