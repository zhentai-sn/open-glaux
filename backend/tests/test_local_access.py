"""SDD 24 §7.2：backend 的 Host 校验与内部令牌。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.local_access import LocalAccessMiddleware, host_name


def _app(token: str | None) -> TestClient:
    inner = FastAPI()

    @inner.get("/health")
    def health() -> dict:
        return {"ok": True}

    @inner.get("/datasources")
    def datasources() -> dict:
        return {"items": []}

    inner.add_middleware(LocalAccessMiddleware, token=token or "")
    return TestClient(inner)


def test_host_name_parsing() -> None:
    assert host_name("LOCALHOST:8000") == "localhost"
    assert host_name("[::1]:8000") == "[::1]"
    assert host_name("127.0.0.1") == "127.0.0.1"


def test_rebound_host_is_rejected() -> None:
    client = _app(None)
    assert client.get("/datasources", headers={"host": "evil.example:8000"}).status_code == 421
    assert client.get("/datasources", headers={"host": "localhost:8000"}).status_code == 200


def test_internal_token_required_except_health() -> None:
    client = _app("t" * 64)
    assert client.get("/health").status_code == 200
    assert client.get("/datasources").status_code == 401
    assert client.get("/datasources", headers={"x-glaux-internal": "x" * 64}).status_code == 401
    assert client.get("/datasources", headers={"x-glaux-internal": "t" * 64}).status_code == 200
