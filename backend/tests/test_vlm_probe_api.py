"""P2 · VLM 探测端点测试——SSRF 守卫 400 + 内核封装的响应形状（SDD §5）。

happy-path monkeypatch ``kernel.vlm_test`` / ``kernel.vlm_models`` 避免真网络；SSRF 拒绝路径
在守卫层短路（不触内核/网络）。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import kernel
from app.main import app

client = TestClient(app)


def test_test_endpoint_openai_needs_base_url() -> None:
    r = client.post("/intent/vlm/test", json={"provider": "openai_compatible"})
    assert r.status_code == 400
    assert "base_url" in r.json()["detail"]


def test_test_endpoint_ssrf_rejects_private(monkeypatch) -> None:
    called = {"n": 0}

    def _spy(*a, **k):
        called["n"] += 1
        return {}

    monkeypatch.setattr(kernel, "vlm_test", _spy)
    r = client.post(
        "/intent/vlm/test",
        json={"provider": "openai_compatible", "base_url": "https://10.0.0.9/v1"},
    )
    assert r.status_code == 400
    assert "被拒" in r.json()["detail"]
    assert called["n"] == 0  # 守卫短路，未进内核


def test_test_endpoint_happy_path(monkeypatch) -> None:
    monkeypatch.setattr(
        kernel, "vlm_test",
        lambda provider, base_url, api_key: {
            "ok": True, "status": 200, "latency_ms": 12,
            "model_count": 5, "vision_count": 2, "reason": "ready",
        },
    )
    r = client.post(
        "/intent/vlm/test",
        json={"provider": "openai_compatible", "base_url": "http://localhost:11434/v1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["model_count"] == 5 and body["vision_count"] == 2


def test_models_endpoint_annotates_vision(monkeypatch) -> None:
    monkeypatch.setattr(
        kernel, "vlm_models",
        lambda provider, base_url, api_key: [
            {"id": "llava:13b", "vision": "yes"},
            {"id": "qwen2.5:7b", "vision": "unknown"},
        ],
    )
    r = client.post(
        "/intent/vlm/models",
        json={"provider": "openai_compatible", "base_url": "http://localhost:11434/v1"},
    )
    assert r.status_code == 200
    models = r.json()["models"]
    assert models == [
        {"id": "llava:13b", "vision": "yes"},
        {"id": "qwen2.5:7b", "vision": "unknown"},
    ]


def test_models_endpoint_fetch_failure_returns_empty(monkeypatch) -> None:
    def _boom(*a, **k):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(kernel, "vlm_models", _boom)
    r = client.post(
        "/intent/vlm/models",
        json={"provider": "openai_compatible", "base_url": "http://localhost:1234/v1"},
    )
    assert r.status_code == 200  # 拉取失败不 500
    body = r.json()
    assert body["models"] == [] and "拉取失败" in body["reason"]
