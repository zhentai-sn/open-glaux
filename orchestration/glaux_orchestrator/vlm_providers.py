"""VLM provider 适配层（连接配置的核心）——SDD 2026-07-14-001 §5。

把「意图后端」里与 provider 相关的 HTTP 关注点（构造 client / ping / 列模型 / 判视觉能力）
抽到一个窄接口 :class:`VLMProvider` 后面，两实现同契约（对齐 IntentBackend / ModelAdapter 的
「接缝」模式）：

- :class:`AnthropicProvider`：anthropic SDK；``base_url`` 可覆盖（自建网关/代理）。
- :class:`OpenAICompatProvider`：httpx 直连 ``{base_url}/models``，
  **覆盖 Ollama / LM Studio 本地部署**。

视觉能力判定尽力而为、逐 provider（§5）：anthropic 按模型族；Ollama 查 ``/api/show``
capabilities；其它兼容网关走名称启发式——**不判 no**（除非 provider 明确），避免误杀。

注意：本模块只做「探测」（ping/list_models），**不含 SSRF 守卫**——URL 放行由 backend 的
``net_guard`` 在调用前把关（provider 层被复用于测试，不应自带网络策略）。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

import httpx

Vision = Literal["yes", "no", "unknown"]

# httpx 超时：连接 3s / 读 8s（本地服务未起时快速失败，不吊死 UI）。
_TIMEOUT = httpx.Timeout(connect=3.0, read=8.0, write=8.0, pool=8.0)

# 名称启发式命中即判有视觉能力（用于无能力元数据的兼容网关 / 作为 Ollama 探测的兜底）。
# 只判 yes，未命中留 unknown——绝不据名判 no（防误杀，让真失败在 interpret 时显式报错）。
_VISION_NAME_TOKENS = (
    "llava", "vision", "gpt-4o", "gpt-4-turbo", "gemini", "pixtral",
    "minicpm-v", "moondream", "bakllava", "cogvlm", "internvl", "granite-vision",
    "qwen-vl", "qwen2-vl", "qwen2.5-vl", "llama-3.2-vision", "-vl", "vl-", ":vl",
)


@dataclass(frozen=True)
class ModelInfo:
    """一个可选模型 + 视觉能力标注（前端据此 👁 / 灰显）。"""

    id: str
    vision: Vision


def name_vision(model_id: str) -> Vision:
    """纯名称启发式：命中已知视觉族 → yes，否则 unknown（永不 no）。"""
    s = model_id.lower()
    return "yes" if any(tok in s for tok in _VISION_NAME_TOKENS) else "unknown"


def anthropic_vision(model_id: str) -> Vision:
    """Anthropic 模型族判定：Claude 3+ 全系支持图像；claude-2/instant/1 无。"""
    s = model_id.lower()
    if s.startswith(("claude-2", "claude-instant", "claude-1")):
        return "no"
    if s.startswith("claude-"):
        return "yes"
    return name_vision(model_id)


def build_anthropic_client(api_key: str | None, base_url: str | None = None) -> Any:
    """构造 anthropic.Anthropic——ClaudeVLMBackend 与 AnthropicProvider 共用（单点）。

    ``base_url`` 为空时不传 → 逐字节等价于旧行为（官方端点）。
    """
    import anthropic

    kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return anthropic.Anthropic(**kwargs)


def _take(iterable: Any, n: int) -> list[Any]:
    out: list[Any] = []
    for i, x in enumerate(iterable):
        if i >= n:
            break
        out.append(x)
    return out


def _model_id(m: Any) -> str | None:
    if isinstance(m, dict):
        return m.get("id")
    return getattr(m, "id", None)


class VLMProvider(ABC):
    """provider 契约：连通探测 + 列模型（含视觉标注）。"""

    provider_id: str = "abstract"

    @abstractmethod
    def ping(self) -> tuple[bool, int | None, str]:
        """(ok, http_status, reason)——不抛栈，异常归类进 reason。"""
        raise NotImplementedError

    @abstractmethod
    def list_models(self) -> list[ModelInfo]:
        """全列可用模型 + 逐项视觉能力。"""
        raise NotImplementedError


class AnthropicProvider(VLMProvider):
    """anthropic SDK 适配——支持 base_url 覆盖。"""

    provider_id = "anthropic"

    def __init__(
        self, base_url: str | None = None, api_key: str | None = None, *, _client: Any = None
    ) -> None:
        self.base_url = base_url or None
        self.api_key = api_key
        self._injected = _client

    def _client(self) -> Any:
        if self._injected is not None:
            return self._injected
        return build_anthropic_client(self.api_key, self.base_url)

    def ping(self) -> tuple[bool, int | None, str]:
        try:
            _take(self._client().models.list(), 1)
            return (True, 200, "ready")
        except Exception as exc:  # noqa: BLE001 - 归类为 reason，不外抛
            status = getattr(exc, "status_code", None)
            if status in (401, 403):
                return (False, status, "鉴权失败（密钥无效？）")
            return (False, status, f"{type(exc).__name__}: {exc}")

    def list_models(self) -> list[ModelInfo]:
        out: list[ModelInfo] = []
        for m in self._client().models.list():
            mid = _model_id(m)
            if mid:
                out.append(ModelInfo(mid, anthropic_vision(mid)))
        return out


class OpenAICompatProvider(VLMProvider):
    """OpenAI 兼容网关适配（含 Ollama / LM Studio 本地部署）。

    ``base_url`` 约定含 ``/v1``（如 ``http://localhost:11434/v1``）；模型端点 =
    ``{base_url}/models``。Ollama 原生 API 在根（非 /v1）：视觉判定额外查
    ``{root}/api/show`` 的 capabilities。
    """

    provider_id = "openai_compatible"

    def __init__(
        self, base_url: str, api_key: str | None = None, *, _client: httpx.Client | None = None
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self._injected = _client

    def _http(self) -> httpx.Client:
        return self._injected if self._injected is not None else httpx.Client(timeout=_TIMEOUT)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def _close(self, client: httpx.Client) -> None:
        if self._injected is None:
            client.close()

    def ping(self) -> tuple[bool, int | None, str]:
        client = self._http()
        try:
            r = client.get(self.base_url + "/models", headers=self._headers())
            ok = r.status_code == 200
            if ok:
                return (True, 200, "ready")
            if r.status_code in (401, 403):
                return (False, r.status_code, "鉴权失败（密钥无效？）")
            if r.status_code == 404:
                return (False, 404, "端点不存在（base_url 是否含 /v1？）")
            return (False, r.status_code, f"HTTP {r.status_code}")
        except httpx.ConnectError:
            return (False, None, "连接被拒（本地服务未启动？）")
        except httpx.TimeoutException:
            return (False, None, "超时")
        except Exception as exc:  # noqa: BLE001
            return (False, None, f"{type(exc).__name__}: {exc}")
        finally:
            self._close(client)

    def list_models(self) -> list[ModelInfo]:
        client = self._http()
        try:
            r = client.get(self.base_url + "/models", headers=self._headers())
            r.raise_for_status()
            data = r.json().get("data", []) or []
            ids = [d.get("id") for d in data if isinstance(d, dict) and d.get("id")]
            root = self._ollama_root()
            is_ollama = self._probe_ollama(client, root)
            out: list[ModelInfo] = []
            for mid in ids:
                v: Vision = "unknown"
                if is_ollama:
                    v = self._ollama_vision(client, root, mid)
                if v == "unknown":
                    v = name_vision(mid)
                out.append(ModelInfo(mid, v))
            return out
        finally:
            self._close(client)

    def _ollama_root(self) -> str:
        b = self.base_url
        return b[:-3] if b.endswith("/v1") else b

    def _probe_ollama(self, client: httpx.Client, root: str) -> bool:
        try:
            return client.get(root + "/api/version").status_code == 200
        except Exception:  # noqa: BLE001
            return False

    def _ollama_vision(self, client: httpx.Client, root: str, model_id: str) -> Vision:
        try:
            r = client.post(root + "/api/show", json={"model": model_id})
            if r.status_code != 200:
                return "unknown"
            caps = r.json().get("capabilities") or []
            if "vision" in caps:
                return "yes"
            return "no" if caps else "unknown"
        except Exception:  # noqa: BLE001
            return "unknown"


def make_provider(provider: str, base_url: str | None, api_key: str | None) -> VLMProvider:
    """provider 字符串 → 适配器实例（kernel/端点用）。"""
    if provider == "openai_compatible":
        if not base_url:
            raise ValueError("openai_compatible 需要 base_url")
        return OpenAICompatProvider(base_url, api_key)
    return AnthropicProvider(base_url, api_key)
