"""P3 · VLM interpret 路由测试——OpenAI 兼容后端解析 + /interpret 的 SSRF 守卫（SDD §5）。

OpenAICompatVLMBackend 用 httpx MockTransport 断网测试；端点 SSRF 拒绝路径在守卫层短路。
"""

from __future__ import annotations

# ruff: noqa: I001 - app.config 必须先行（装配 sys.path 供 glaux_orchestrator）
import json

import app.config  # noqa: F401
import httpx
from fastapi.testclient import TestClient

from app.main import app
from glaux_orchestrator.intent import IntentBackendUnavailable, OpenAICompatVLMBackend
from glaux_orchestrator.spec import Scope

import pytest

client = TestClient(app)


def _chat_client(
    tool_args: dict | None, *, status: int = 200, with_call: bool = True
) -> httpx.Client:
    """构造回一个 chat/completions 响应的 mock httpx.Client。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if not request.url.path.endswith("/chat/completions"):
            return httpx.Response(404)
        msg: dict = {"role": "assistant"}
        if with_call:
            msg["tool_calls"] = [
                {"function": {"name": "report_intent", "arguments": json.dumps(tool_args or {})}}
            ]
        return httpx.Response(status, json={"choices": [{"message": msg}]})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_openai_compat_in_scope() -> None:
    c = _chat_client({"scope": "in_scope", "task": "far_wall_cca_imt", "reason": "颈动脉远壁 IMT"})
    b = OpenAICompatVLMBackend(_client=c)
    r = b.interpret("测远壁 IMT", model="llava:13b", base_url="http://localhost:11434/v1")
    assert r.scope is Scope.IN_SCOPE
    assert r.spec is not None and r.spec.task.value == "far_wall_cca_imt"


def test_openai_compat_ambiguous_when_no_task() -> None:
    c = _chat_client({"scope": "in_scope", "reason": "有测量意图但没说测哪"})
    r = OpenAICompatVLMBackend(_client=c).interpret("测一下", model="m", base_url="http://localhost:1234/v1")
    assert r.scope is Scope.AMBIGUOUS and r.spec is None


def test_openai_compat_chat_reply() -> None:
    # 闲聊：scope=chat，reason 即自然回复，不带 spec（测量路径不触发）。
    c = _chat_client({"scope": "chat", "reason": "你好！我可以帮你测颈动脉 IMT、胎儿头围。"})
    r = OpenAICompatVLMBackend(_client=c).interpret("你好", model="m", base_url="http://localhost:11434/v1")
    assert r.scope is Scope.CHAT and r.spec is None
    assert "你好" in r.reason


def test_openai_compat_chat_empty_reason_fallback() -> None:
    c = _chat_client({"scope": "chat", "reason": ""})
    r = OpenAICompatVLMBackend(_client=c).interpret("hi", model="m", base_url="http://localhost:1234/v1")
    assert r.scope is Scope.CHAT and "Glaux" in r.reason  # 兜底回复


def test_openai_compat_requires_base_url_and_model() -> None:
    b = OpenAICompatVLMBackend(_client=_chat_client({}))
    with pytest.raises(IntentBackendUnavailable, match="base_url"):
        b.interpret("x", model="m", base_url=None)
    with pytest.raises(IntentBackendUnavailable, match="模型"):
        b.interpret("x", model=None, base_url="http://localhost:11434/v1")


def test_openai_compat_no_tool_call_raises() -> None:
    c = _chat_client(None, with_call=False)
    with pytest.raises(IntentBackendUnavailable, match="report_intent"):
        OpenAICompatVLMBackend(_client=c).interpret("x", model="m", base_url="http://localhost:11434/v1")


def test_interpret_endpoint_ssrf_guard() -> None:
    r = client.post(
        "/interpret",
        json={"nl": "测 IMT", "backend": "vlm", "provider": "openai_compatible",
              "base_url": "https://10.0.0.9/v1"},
    )
    assert r.status_code == 400 and "被拒" in r.json()["detail"]


def test_interpret_endpoint_openai_needs_base_url() -> None:
    r = client.post(
        "/interpret",
        json={"nl": "测 IMT", "backend": "vlm", "provider": "openai_compatible"},
    )
    assert r.status_code == 400 and "base_url" in r.json()["detail"]


def test_interpret_rule_backend_unaffected() -> None:
    # 回归：默认 rule 后端行为不变（provider 默认 anthropic，无 base_url → 无守卫触发）。
    r = client.post("/interpret", json={"nl": "测一下这张颈动脉的远壁 IMT"})
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "in_scope" and body["spec"]["task"] == "far_wall_cca_imt"
