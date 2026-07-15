"""SSRF 守卫——VLM 探测端点在向**用户提供的 base_url** 发起请求前调用（SDD 2026-07-14-001 §6）。

本地部署（Ollama/LM Studio 在 localhost）与「拒绝任意内网」直接冲突，故显式区分**回环**与
**其它内网**：
- scheme 远端限 ``https``；``http`` 仅放行解析到**回环**的 host。
- 判定基于 :func:`socket.getaddrinfo` **解析后的 IP**（防 ``localhost.attacker.com`` /
  DNS rebinding），不只看字符串。
- 回环放行（本地部署）；其它私网/保留/链路本地地址一律拒，除非命中显式 host 白名单
  （env ``GLAUX_VLM_HOST_ALLOW``，逗号分隔）。

残留风险（v0 已知，待安全评审）：解析在此、httpx 在请求时再解析一次 = TOCTOU（DNS rebinding
仍有缝）。彻底缓解需把解析到的 IP 钉进连接；v0 先做「解析后判定 + 回环白名单」，评审后加固。
"""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlparse


class UrlNotAllowed(Exception):
    """base_url 未通过 SSRF 守卫——端点据此返回 400。"""


# fake-ip 代理占位段（RFC 2544 基准测试保留 198.18.0.0/15）——Clash/Surge/sing-box 的
# fake-ip 模式默认把域名映射到此段做透明代理。现实中此段不承载真实内部服务，故可选放行。
_FAKEIP_NET = ipaddress.ip_network("198.18.0.0/15")


def _host_allowlist() -> set[str]:
    raw = os.getenv("GLAUX_VLM_HOST_ALLOW", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _allow_fakeip() -> bool:
    """是否放行 fake-ip 段（GLAUX_VLM_ALLOW_FAKEIP）——透明代理用户的口子，缺省关。"""
    return os.getenv("GLAUX_VLM_ALLOW_FAKEIP", "").strip().lower() in ("1", "true", "yes", "on")


def _resolve_ips(host: str) -> list[ipaddress._BaseAddress]:
    """host → 解析到的 IP 列表（模块级函数，便于测试 monkeypatch）。"""
    infos = socket.getaddrinfo(host, None)
    return [ipaddress.ip_address(sockaddr[0]) for *_head, sockaddr in infos]


def assert_url_allowed(url: str) -> None:
    """URL 不满足策略即抛 :class:`UrlNotAllowed`；满足则静默返回。"""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise UrlNotAllowed(f"scheme 不允许：{p.scheme or '(空)'}（仅 http/https）")
    host = p.hostname
    if not host:
        raise UrlNotAllowed("URL 缺 host")

    if host.lower() in _host_allowlist():
        return  # 显式白名单：绕过 IP 判定（部署方自担）

    try:
        ips = _resolve_ips(host)
    except OSError as exc:
        raise UrlNotAllowed(f"host 解析失败：{host}（{exc}）") from exc
    if not ips:
        raise UrlNotAllowed(f"host 无解析结果：{host}")

    all_loopback = all(ip.is_loopback for ip in ips)
    if p.scheme == "http" and not all_loopback:
        raise UrlNotAllowed("http 仅允许回环地址（本地部署）；远端请用 https")

    fakeip_ok = _allow_fakeip()
    for ip in ips:
        if ip.is_loopback:
            continue  # 回环显式放行（本地部署 Ollama/LM Studio）
        if fakeip_ok and ip.version == 4 and ip in _FAKEIP_NET:
            continue  # fake-ip 代理占位段（198.18.0.0/15）——GLAUX_VLM_ALLOW_FAKEIP 显式放行
        if (
            ip.is_private
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            is_fakeip = ip.version == 4 and ip in _FAKEIP_NET
            hint = "GLAUX_VLM_ALLOW_FAKEIP" if is_fakeip else "GLAUX_VLM_HOST_ALLOW"
            raise UrlNotAllowed(f"拒绝内网/保留地址：{ip}（如需请配 {hint}）")
