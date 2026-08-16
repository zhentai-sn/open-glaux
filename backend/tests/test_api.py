"""F4/F5–F9 端点测试：契约形状 + 真实数据接入 + 主进程无 TF / 无 LLM SDK。

数据可用时测真实接入；不可用时测 mock 回退——两条路径的契约形状一致。
"""

import importlib.util
import sys

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
    assert {t["id"] for t in imt["tools"]} >= {"cursor", "bbox", "polygon", "brush"}
    assert imt["capabilities"] == ["bbox", "polygon", "brush"]  # SDD 04 能力位下发
    assert imt["overlays"][0]["role"] == "LI"
    hc = by_id["fetal_hc"]
    assert hc["adapter_kind"] == "contour"
    assert any(m["key"] == "HC" for m in hc["metrics"])


def test_capabilities_registry_four_layers():
    """GET /capabilities 下发能力清单——按「环境四层」本体，含真实 skill/model/dataset + 占位卡。"""
    r = client.get("/capabilities")
    assert r.status_code == 200
    caps = r.json()
    layers = {c["layer"] for c in caps}
    assert {"representation", "action", "verification", "memory"} <= layers
    kinds = {c["kind"] for c in caps}
    # skill = TaskPlugin：两个任务各一张 skill 卡（动作层）
    ids = {c["id"] for c in caps}
    assert {"skill:far_wall_cca_imt", "skill:fetal_hc"} <= ids
    assert all(c["layer"] == "action" for c in caps if c["kind"] == "skill")
    # 真实 model（caroSegDeep 动作层）
    assert any(c["id"] == "caroSegDeep" and c["kind"] == "model" and c["layer"] == "action" for c in caps)
    # dataset（表征层）
    assert any(c["kind"] == "dataset" and c["layer"] == "representation" for c in caps)
    # 有类型占位卡（planned）：connector/mcp/knowledge_base
    assert any(c["status"] == "planned" for c in caps)
    assert {"connector", "mcp", "knowledge_base"} <= kinds


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


# --- 真实数据接入专项（无数据环境跳过） -------------------------------------

def test_real_dataset_cohort():
    if not HAS_DATA:
        return
    imgs = client.get("/images").json()
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
