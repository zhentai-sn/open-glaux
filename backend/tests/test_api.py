"""F4 冒烟测试：八端点形状 + 三态守卫 + PNG 魔数 + 主进程无 TF。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_no_tf_in_process():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["tf_in_process"] is False


def test_interpret_three_states():
    assert client.post("/interpret", json={"nl": "测远壁颈动脉 IMT"}).json()["scope"] == "in_scope"
    assert client.post("/interpret", json={"nl": "分析一下这张图"}).json()["scope"] == "ambiguous"
    assert client.post("/interpret", json={"nl": "计算左心室射血分数"}).json()["scope"] == "out_of_scope"


def test_interpret_non_in_scope_has_no_spec():
    r = client.post("/interpret", json={"nl": "分割乳腺肿瘤"}).json()
    assert r["scope"] == "out_of_scope" and r["spec"] is None


def test_interpret_in_scope_carries_spec():
    r = client.post("/interpret", json={"nl": "测 IMT", "image_id": "tech_437", "cubs_cf": 0.0559}).json()
    assert r["spec"]["task"] == "far_wall_cca_imt"
    assert r["spec"]["cubs_cf"] == 0.0559


def test_run_returns_measurement():
    r = client.post("/run", json={"task": "far_wall_cca_imt", "cubs_cf": 0.0559}).json()
    assert r["cf_source"] == "cubs"
    assert 0.5 < r["mean_mm"] < 1.5  # 生理区间的 mock IMT
    assert r["n_columns"] > 0


def test_measure_matches_imtresult_shape():
    li = [[0, 100], [10, 100]]
    ma = [[0, 116.4], [10, 116.4]]
    r = client.post("/measure", json={"li": li, "ma": ma, "cf": 0.0559}).json()
    assert set(r) == {"mean_mm", "max_mm", "pdm_mean_mm", "per_column_um", "n_columns"}


def test_images_and_models():
    imgs = client.get("/images").json()
    assert len(imgs) > 0 and imgs[0]["center"] == "CUBS-tech"
    models = client.get("/models").json()
    assert any(m["active"] for m in models)
    assert models[0]["id"] == "caroSegDeep"


def test_image_returns_png():
    r = client.get("/image/tech_437")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_segment_and_correction():
    seg = client.post("/segment", json={"image_id": "tech_437", "model": "caroSegDeep"}).json()
    assert len(seg["li"]) > 0 and seg["model_version"].endswith("@mock")
    corr = client.post(
        "/correction",
        json={"image_id": "tech_437", "which": "MA", "points": [[0, 1]], "imt": 0.92},
    ).json()
    assert corr["ok"] and corr["provenance"]["source"] == "human"
