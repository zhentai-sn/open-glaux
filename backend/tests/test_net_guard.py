"""P2 · SSRF 守卫单测（SDD 2026-07-14-001 §6）——回环放行 vs 内网拒绝，基于解析 IP。

用 monkeypatch 替换 ``net_guard._resolve_ips`` 使测试**不触真实 DNS/网络**、结果确定。
"""

from __future__ import annotations

import ipaddress

import pytest

from app import net_guard
from app.net_guard import UrlNotAllowed, assert_url_allowed


def _patch_resolve(monkeypatch: pytest.MonkeyPatch, ips: list[str]) -> None:
    resolved = [ipaddress.ip_address(i) for i in ips]
    monkeypatch.setattr(net_guard, "_resolve_ips", lambda host: resolved)


def test_https_public_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_resolve(monkeypatch, ["160.79.104.10"])  # anthropic 公网
    assert_url_allowed("https://api.anthropic.com/v1")  # 不抛即通过


def test_http_loopback_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_resolve(monkeypatch, ["127.0.0.1"])
    assert_url_allowed("http://localhost:11434/v1")  # 本地 Ollama


def test_http_public_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_resolve(monkeypatch, ["8.8.8.8"])
    with pytest.raises(UrlNotAllowed, match="回环"):
        assert_url_allowed("http://evil.example.com/v1")


def test_https_private_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_resolve(monkeypatch, ["10.0.0.5"])
    with pytest.raises(UrlNotAllowed, match="内网"):
        assert_url_allowed("https://10.0.0.5/v1")


def test_rebinding_http_public_disguised_as_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    # localhost.attacker.com 解析到公网 → http 非回环 → 拒（不看字符串，看解析 IP）。
    _patch_resolve(monkeypatch, ["203.0.113.7"])
    with pytest.raises(UrlNotAllowed):
        assert_url_allowed("http://localhost.attacker.com/v1")


def test_bad_scheme_rejected() -> None:
    with pytest.raises(UrlNotAllowed, match="scheme"):
        assert_url_allowed("ftp://example.com/x")


def test_host_allowlist_bypass(monkeypatch: pytest.MonkeyPatch) -> None:
    # 显式白名单 → 绕过 IP 判定（即便解析到私网）。
    monkeypatch.setenv("GLAUX_VLM_HOST_ALLOW", "gpu-box.internal")
    _patch_resolve(monkeypatch, ["10.1.2.3"])
    assert_url_allowed("https://gpu-box.internal:8000/v1")


def test_fakeip_blocked_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # 缺省：fake-ip 段（198.18.0.0/15）按保留地址拒，提示指向专用开关。
    monkeypatch.delenv("GLAUX_VLM_ALLOW_FAKEIP", raising=False)
    _patch_resolve(monkeypatch, ["198.18.0.32"])
    with pytest.raises(UrlNotAllowed, match="GLAUX_VLM_ALLOW_FAKEIP"):
        assert_url_allowed("https://gw.example.com/v1")


def test_fakeip_allowed_when_toggled(monkeypatch: pytest.MonkeyPatch) -> None:
    # GLAUX_VLM_ALLOW_FAKEIP=1 → 放行 198.18.0.0/15（透明代理占位）。
    monkeypatch.setenv("GLAUX_VLM_ALLOW_FAKEIP", "1")
    _patch_resolve(monkeypatch, ["198.18.0.32"])
    assert_url_allowed("https://gw.example.com/v1")


def test_fakeip_toggle_does_not_relax_real_private(monkeypatch: pytest.MonkeyPatch) -> None:
    # 开了 fake-ip 也只放行 198.18/15，真实私网（10/8）仍拒。
    monkeypatch.setenv("GLAUX_VLM_ALLOW_FAKEIP", "1")
    _patch_resolve(monkeypatch, ["10.0.0.5"])
    with pytest.raises(UrlNotAllowed, match="内网"):
        assert_url_allowed("https://sneaky.example.com/v1")
