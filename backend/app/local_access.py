"""本机访问守卫（SDD 24 §7.2）。

- Host 只接受回环名，挡 DNS 重绑定（开发态 Vite 代理以 ``localhost:<端口>`` 访问；
  ``testserver`` 是 Starlette ``TestClient`` 的缺省 Host）。
- 生产模式设置 ``GLAUX_BACKEND_TOKEN`` 时，除 ``/health`` 外要求请求头
  ``X-Glaux-Internal`` 与之一致；浏览器只能经 agent-runtime 的反代访问 backend。
"""

from __future__ import annotations

import hmac
import os

from starlette.types import ASGIApp, Receive, Scope, Send

ALLOWED_HOST_NAMES = frozenset({"127.0.0.1", "localhost", "[::1]", "testserver"})
INTERNAL_HEADER = b"x-glaux-internal"
OPEN_PATHS = frozenset({"/health"})


def host_name(value: str) -> str:
    """``host[:port]`` → 小写主机名；IPv6 字面量保留方括号。"""
    value = value.strip().lower()
    if value.startswith("["):
        return value[: value.find("]") + 1] if "]" in value else ""
    return value.split(":", 1)[0]


class LocalAccessMiddleware:
    def __init__(self, app: ASGIApp, token: str | None = None) -> None:
        self.app = app
        if token is None:
            token = os.environ.get("GLAUX_BACKEND_TOKEN") or ""
        self.token = token.strip()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        host = headers.get(b"host", b"").decode("latin-1")
        if host_name(host) not in ALLOWED_HOST_NAMES:
            await _reject(send, 421, b"Misdirected Request")
            return
        if self.token and scope.get("path") not in OPEN_PATHS:
            presented = headers.get(INTERNAL_HEADER, b"").decode("latin-1")
            if not hmac.compare_digest(presented, self.token):
                await _reject(send, 401, b"Unauthorized")
                return
        await self.app(scope, receive, send)


async def _reject(send: Send, status: int, body: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"text/plain"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
