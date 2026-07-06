"""F4/F5–F9 端点测试：契约形状 + 三态守卫 + 真实数据接入 + 主进程无 TF。

数据可用时测真实接入；不可用时测 mock 回退——两条路径的契约形状一致。
"""

import importlib.util

from fastapi.testclient import TestClient

from app import config
from app.main import app

client = TestClient(app)
HAS_DATA = config.data_available()


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


# --- 第二模态：胎儿头围（HC，合成数据；不依赖 CUBS） ------------------------

def test_hc_images_modality_tagged():
    imgs = client.get("/images", params={"modality": "fetal_hc"}).json()
    assert len(imgs) == 10
    assert all(m["modality"] == "fetal_hc" and m["cf"] > 0 for m in imgs)
    assert imgs[0]["id"].startswith("hc_")


def test_hc_image_returns_png():
    r = client.get("/image/hc_003")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_hc_run_detects_near_ground_truth():
    r = client.post("/hc/run", json={"image_id": "hc_004"}).json()
    assert 100 < r["hc_mm"] < 300  # 生理量级（合成）
    assert r["ofd_mm"] > r["bpd_mm"]  # 枕额径（长轴）> 双顶径（短轴）
    assert r["vs_gt_mm"] is not None and r["vs_gt_mm"] < 3.0  # 真检测贴近真值
    assert len(r["contour"]) >= 5 and "ellipse" in r


def test_hc_measure_from_contour_roundtrips():
    run = client.post("/hc/run", json={"image_id": "hc_006"}).json()
    m = client.post("/hc/measure", json={"points": run["contour"], "cf": run["cf"]}).json()
    assert abs(m["hc_mm"] - run["hc_mm"]) < 2.0  # 由检测轮廓重测应一致量级


def test_hc_run_rejects_non_hc_id():
    assert client.post("/hc/run", json={"image_id": "tech_401"}).status_code == 422


def test_hc_intent_routes_to_fetal_task():
    r = client.post("/interpret", json={"nl": "测这张胎儿颅脑图的头围"}).json()
    assert r["scope"] == "in_scope" and r["spec"]["task"] == "fetal_hc"


def test_models_include_both_modalities():
    ids = {m["id"]: m for m in client.get("/models").json()}
    assert "ellipse-fit" in ids and ids["ellipse-fit"]["modality"] == "fetal_hc"
