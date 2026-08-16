"""出站 SSRF 守卫——向**用户提供的 URL** 发请求前调用（Atlas 网页导入，SDD 03 §4.3）。

规则与 ``agent-runtime/src/security/net-guard.ts`` 逐条对齐（该 TS 版本身移植自本文件的前身，
2026-08-16 退役 orchestration P3 时删除；Atlas 网页导入需要 Python 侧守卫，故按 TS 规范重建）：
- scheme 仅 http/https；``allow_plain_http=False`` 时 http 只放行解析到**回环**的 host。
- 判定基于 **DNS 解析后的 IP**（防 localhost.attacker.com / rebinding），不看字符串。
- 回环放行；其它私网 / 链路本地 / 保留 / 组播 / 未指定地址一律拒，除非：
  - host 命中 ``GLAUX_VLM_HOST_ALLOW``（逗号分隔，显式白名单，部署方自担）；
  - IP 落在 fake-ip 段 198.18.0.0/15 且 ``GLAUX_VLM_ALLOW_FAKEIP`` 打开（透明代理用户）。

残留风险同 TS 版：解析在此、fetch 时再解析一次 = TOCTOU（rebinding 仍有缝）。
"""

from __future__ import annotations

import ipaddress
import os
import socket
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

ResolveHost = Callable[[str], list[str]]

_FAKE_IP_NET = ipaddress.ip_network("198.18.0.0/15")


class EgressBlocked(Exception):
    """URL 不满足出站策略。``code`` 固定 ``egress_blocked``（与 TS 版 RuntimeError 对齐）。"""

    code = "egress_blocked"


@dataclass(frozen=True)
class IpClass:
    loopback: bool
    fake_ip: bool
    blocked: bool


def classify_ip(ip: str) -> IpClass:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return IpClass(False, False, True)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    fake = isinstance(addr, ipaddress.IPv4Address) and addr in _FAKE_IP_NET
    blocked = (
        addr.is_private
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    ) and not addr.is_loopback
    return IpClass(loopback=addr.is_loopback, fake_ip=fake, blocked=blocked)


def _default_resolve(host: str) -> list[str]:
    try:
        ipaddress.ip_address(host)
        return [host]
    except ValueError:
        pass
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    out: list[str] = []
    for info in infos:
        ip = info[4][0]
        if ip not in out:
            out.append(ip)
    return out


def _host_allowlist(env: Mapping[str, str]) -> set[str]:
    raw = env.get("GLAUX_VLM_HOST_ALLOW", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _allow_fake_ip(env: Mapping[str, str]) -> bool:
    return env.get("GLAUX_VLM_ALLOW_FAKEIP", "").strip().lower() in ("1", "true", "yes", "on")


def assert_url_allowed(
    url: str,
    *,
    allow_plain_http: bool = False,
    resolve_host: ResolveHost | None = None,
    env: Mapping[str, str] | None = None,
) -> None:
    """URL 不满足策略即抛 :class:`EgressBlocked`；满足则静默返回。

    ``allow_plain_http=True``（Atlas 网页导入）：公开地址也允许 http——只读抓取、不带凭据。
    """
    env = os.environ if env is None else env
    resolve = resolve_host or _default_resolve

    parts = urlsplit(url)
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise EgressBlocked(f"scheme 不允许：{scheme or '(空)'}（仅 http/https）")
    host = (parts.hostname or "").strip("[]")
    if not host:
        raise EgressBlocked("URL 缺 host")

    if host.lower() in _host_allowlist(env):
        return

    try:
        ips = resolve(host)
    except Exception as exc:  # noqa: BLE001 - 解析失败一律视作拒绝
        raise EgressBlocked(f"host 解析失败：{host}（{exc}）") from exc
    if not ips:
        raise EgressBlocked(f"host 无解析结果：{host}")

    classes = [classify_ip(ip) for ip in ips]
    if scheme == "http" and not allow_plain_http and not all(c.loopback for c in classes):
        raise EgressBlocked("http 仅允许回环地址（本地部署）；远端请用 https")

    fake_ok = _allow_fake_ip(env)
    for ip, c in zip(ips, classes, strict=True):
        if c.loopback:
            continue
        if fake_ok and c.fake_ip:
            continue
        if c.blocked:
            hint = "GLAUX_VLM_ALLOW_FAKEIP" if c.fake_ip else "GLAUX_VLM_HOST_ALLOW"
            raise EgressBlocked(f"拒绝内网/保留地址：{ip}（如需请配 {hint}）")
