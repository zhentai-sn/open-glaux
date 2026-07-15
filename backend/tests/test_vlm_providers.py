"""P1 · VLM provider 适配层单测——ping / list_models / 视觉判定（SDD 2026-07-14-001 §5）。

放 backend/tests 以在 backend venv（含 anthropic + httpx）内跑；``import app.config`` 把
science-core / orchestration 挂上 sys.path（同其它 backend 测试）。
"""

from __future__ import annotations

# ruff: noqa: I001 - 导入顺序有意：app.config 必须先行（装配 sys.path 供 glaux_orchestrator）
import app.config  # noqa: F401 - 触发 sys.path 装配（science-core / orchestration）
import httpx
import pytest

from glaux_orchestrator.vlm_providers import (
    AnthropicProvider,
    ModelInfo,
    OpenAICompatProvider,
    anthropic_vision,
    make_provider,
    name_vision,
)

# --- 视觉能力启发式 ---------------------------------------------------------

@pytest.mark.parametrize(
    "mid,expect",
    [
        ("llava:13b", "yes"),
        ("qwen2.5-vl:7b", "yes"),
        ("gpt-4o", "yes"),
        ("minicpm-v", "yes"),
        ("qwen2.5:7b", "unknown"),  # 非视觉，不误判 no
        ("llama3.1:8b", "unknown"),
    ],
)
def test_name_vision(mid: str, expect: str) -> None:
    assert name_vision(mid) == expect


@pytest.mark.parametrize(
    "mid,expect",
    [
        ("claude-haiku-4-5-20251001", "yes"),
        ("claude-3-5-sonnet-20241022", "yes"),
        ("claude-opus-4-20250101", "yes"),
        ("claude-2.1", "no"),
        ("claude-instant-1.2", "no"),
    ],
)
def test_anthropic_vision(mid: str, expect: str) -> None:
    assert anthropic_vision(mid) == expect


# --- AnthropicProvider（注入假 client） -------------------------------------

class _FakeModel:
    def __init__(self, mid: str) -> None:
        self.id = mid


class _FakeModels:
    def __init__(self, ids: list[str], *, raise_status: int | None = None) -> None:
        self._ids = ids
        self._raise = raise_status

    def list(self, *a, **k):  # noqa: ANN002, ANN003
        if self._raise is not None:
            exc = RuntimeError("boom")
            exc.status_code = self._raise  # type: ignore[attr-defined]
            raise exc
        return [_FakeModel(i) for i in self._ids]


class _FakeClient:
    def __init__(self, models: _FakeModels) -> None:
        self.models = models


def test_anthropic_list_models_all_vision() -> None:
    client = _FakeClient(_FakeModels(["claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022"]))
    p = AnthropicProvider(_client=client)
    models = p.list_models()
    assert [m.id for m in models] == ["claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022"]
    assert all(m.vision == "yes" for m in models)


def test_anthropic_ping_ok_and_auth_fail() -> None:
    ok_p = AnthropicProvider(_client=_FakeClient(_FakeModels(["claude-3-5-sonnet"])))
    assert ok_p.ping() == (True, 200, "ready")
    fail_p = AnthropicProvider(_client=_FakeClient(_FakeModels([], raise_status=401)))
    ok, status, reason = fail_p.ping()
    assert ok is False and status == 401 and "鉴权" in reason


# --- OpenAICompatProvider（httpx MockTransport） ----------------------------

def _mock_client(routes: dict) -> httpx.Client:
    """routes: (method, path_suffix) → (status, json)。"""

    def handler(request: httpx.Request) -> httpx.Response:
        for (method, suffix), (status, body) in routes.items():
            if request.method == method and request.url.path.endswith(suffix):
                return httpx.Response(status, json=body)
        return httpx.Response(404, json={"error": "no route"})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_openai_compat_ollama_vision_via_api_show() -> None:
    # Ollama：/v1/models 列两个；/api/version 200（判定为 Ollama）；/api/show 给 capabilities。
    client = _mock_client({
        ("GET", "/v1/models"): (200, {"data": [{"id": "llava:13b"}, {"id": "qwen2.5:7b"}]}),
        ("GET", "/api/version"): (200, {"version": "0.5.0"}),
        ("POST", "/api/show"): (200, {"capabilities": ["completion", "vision"]}),
    })
    p = OpenAICompatProvider("http://localhost:11434/v1", _client=client)
    models = p.list_models()
    assert models == [ModelInfo("llava:13b", "yes"), ModelInfo("qwen2.5:7b", "yes")]
    # 注：本 mock 对所有 /api/show 都回 vision → 两者皆 yes；非 Ollama 场景见下。


def test_openai_compat_non_ollama_name_heuristic() -> None:
    # 无 /api/version（非 Ollama）→ 名称启发式：llava→yes，纯文本→unknown。
    client = _mock_client({
        ("GET", "/v1/models"): (200, {"data": [{"id": "llava-v1.6"}, {"id": "mistral-7b"}]}),
    })
    p = OpenAICompatProvider("http://localhost:1234/v1", _client=client)
    models = p.list_models()
    assert models == [ModelInfo("llava-v1.6", "yes"), ModelInfo("mistral-7b", "unknown")]


def test_openai_compat_ping_conn_refused() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    ok, status, reason = OpenAICompatProvider("http://localhost:11434/v1", _client=client).ping()
    assert ok is False and status is None and "连接被拒" in reason


def test_make_provider_requires_base_url_for_compat() -> None:
    assert isinstance(make_provider("anthropic", None, "k"), AnthropicProvider)
    assert isinstance(make_provider("openai_compatible", "http://x/v1", None), OpenAICompatProvider)
    with pytest.raises(ValueError):
        make_provider("openai_compatible", None, None)
