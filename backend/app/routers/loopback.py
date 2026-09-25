"""回环来源守卫（SDD 13 §7.1 规则 3、D-2）。

``/fs/*`` 与 ``/projects*`` 能浏览、登记本机任意目录，不受 ``GLAUX_DATASETS_ROOT`` 白名单约束；
以「只接受回环地址来源」收住对外暴露面。请求带 ``X-Forwarded-For`` 或 RFC 7239 ``Forwarded`` 头时
（开发态经 Vite 代理，``xfwd``），其中每一跳也须是回环。作为 router 级依赖挂载；测试经
``app.dependency_overrides[require_loopback]`` 放行（``TestClient`` 的来源地址是 ``testclient``）。
"""

from __future__ import annotations

import ipaddress

from fastapi import HTTPException, Request

LOOPBACK_ADDRS = frozenset({ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("::1")})


def is_loopback(host: str | None) -> bool:
    """``127.0.0.1`` 或 ``::1``；双栈监听时的 IPv4 映射写法 ``::ffff:127.0.0.1`` 同样认。"""
    try:
        ip = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip in LOOPBACK_ADDRS


def _forwarded_for(value: str) -> list[str]:
    """RFC 7239 ``Forwarded`` 头里各跳的 ``for=`` 值，去引号、方括号与端口。

    ``for="[::1]:1234"`` → ``::1``；``for=127.0.0.1:80`` → ``127.0.0.1``；``for=unknown`` 与
    混淆标识（``_hidden``）原样返回，交由 :func:`is_loopback` 判为非回环。
    """
    out: list[str] = []
    for hop in value.split(","):
        for pair in hop.split(";"):
            key, sep, raw = pair.strip().partition("=")
            if not sep or key.strip().lower() != "for":
                continue
            v = raw.strip().strip('"')
            if v.startswith("["):  # IPv6：[addr] 或 [addr]:port
                v = v[1:].split("]", 1)[0]
            elif v.count(":") == 1:  # IPv4:port
                v = v.split(":", 1)[0]
            out.append(v)
    return out


def _hops(request: Request) -> list[str | None]:
    """需判定的来源：直连地址，外加 ``X-Forwarded-For`` 与 ``Forwarded`` 头里的每一跳。

    开发服务器以 ``vite --host`` 对局域网开放、经代理转发到后端时，直连地址恒为回环；只看直连
    会让局域网请求绕过守卫，故带转发头时每一跳都须是回环。
    """
    hops: list[str | None] = [request.client.host if request.client else None]
    for value in request.headers.getlist("x-forwarded-for"):
        hops.extend(h.strip() for h in value.split(","))
    for value in request.headers.getlist("forwarded"):
        hops.extend(_forwarded_for(value))
    return hops


def require_loopback(request: Request) -> None:
    """直连来源或任一转发跳不是回环地址 → 403，响应体说明原因。"""
    for host in _hops(request):
        if not is_loopback(host):
            raise HTTPException(
                403,
                f"该端点只接受本机回环地址（127.0.0.1、::1）来源的请求，当前来源：{host or '未知'}",
            )
