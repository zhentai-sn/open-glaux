"""出站守卫（Python 版，按 agent-runtime/tests/security/net-guard.test.ts 平移）。

基于解析 IP，不触真实 DNS。
"""

from __future__ import annotations

import pytest

from app.net_guard import EgressBlocked, assert_url_allowed, classify_ip


def _to(*ips):
    return lambda host: list(ips)


ENV: dict[str, str] = {}


def test_allows_https_public():
    assert_url_allowed("https://api.anthropic.com/v1", resolve_host=_to("160.79.104.10"), env=ENV)


def test_allows_http_loopback():
    assert_url_allowed("http://localhost:11434/v1", resolve_host=_to("127.0.0.1"), env=ENV)
    assert_url_allowed("http://[::1]:1234/v1", resolve_host=_to("::1"), env=ENV)


def test_rejects_http_public_by_default_but_allows_when_plain_http_ok():
    with pytest.raises(EgressBlocked, match="回环"):
        assert_url_allowed("http://evil.example.com/v1", resolve_host=_to("8.8.8.8"), env=ENV)
    assert_url_allowed(
        "http://public.example.com/", resolve_host=_to("8.8.8.8"), env=ENV, allow_plain_http=True
    )


def test_rejects_private_and_judges_by_resolved_ip():
    with pytest.raises(EgressBlocked, match="内网"):
        assert_url_allowed("https://10.0.0.5/v1", resolve_host=_to("10.0.0.5"), env=ENV)
    with pytest.raises(EgressBlocked):
        assert_url_allowed(
            "http://localhost.attacker.com/v1", resolve_host=_to("10.0.0.5"), env=ENV
        )
    with pytest.raises(EgressBlocked, match="内网"):
        assert_url_allowed(
            "https://x.example/", resolve_host=_to("8.8.8.8", "192.168.1.1"), env=ENV
        )


def test_rejects_link_local_metadata_and_bad_scheme():
    with pytest.raises(EgressBlocked):
        assert_url_allowed(
            "https://169.254.169.254/latest", resolve_host=_to("169.254.169.254"), env=ENV
        )
    with pytest.raises(EgressBlocked, match="scheme"):
        assert_url_allowed("file:///etc/passwd", resolve_host=_to("127.0.0.1"), env=ENV)
    with pytest.raises(EgressBlocked, match="scheme"):
        assert_url_allowed("ftp://x/", resolve_host=_to("8.8.8.8"), env=ENV)


def test_fake_ip_allowed_by_default_and_can_be_disabled():
    # 默认放行 198.18/15（透明代理 fake-ip），但真实私网段照拒。
    assert_url_allowed("https://api.example.com/", resolve_host=_to("198.18.0.5"), env=ENV)
    with pytest.raises(EgressBlocked, match="内网"):
        assert_url_allowed("https://sneaky.example.com/", resolve_host=_to("10.0.0.5"), env=ENV)
    # 显式关闭后回到拒绝，并提示开关。
    with pytest.raises(EgressBlocked, match="GLAUX_VLM_ALLOW_FAKEIP"):
        assert_url_allowed(
            "https://api.example.com/",
            resolve_host=_to("198.18.0.5"),
            env={"GLAUX_VLM_ALLOW_FAKEIP": "0"},
        )


def test_host_allowlist_bypasses_resolution():
    assert_url_allowed(
        "https://intranet.corp/",
        resolve_host=_to("10.1.1.1"),
        env={"GLAUX_VLM_HOST_ALLOW": "intranet.corp, other"},
    )


def test_resolution_failure_blocks():
    def boom(host):
        raise OSError("nxdomain")

    with pytest.raises(EgressBlocked, match="解析失败"):
        assert_url_allowed("https://nope.invalid/", resolve_host=boom, env=ENV)
    with pytest.raises(EgressBlocked, match="无解析结果"):
        assert_url_allowed("https://nope.invalid/", resolve_host=_to(), env=ENV)


def test_classify_ip_shapes():
    assert classify_ip("127.0.0.1").loopback and not classify_ip("127.0.0.1").blocked
    assert classify_ip("::ffff:10.0.0.1").blocked
    assert classify_ip("198.19.1.1").fake_ip and classify_ip("198.19.1.1").blocked
    assert classify_ip("not-an-ip").blocked
    assert not classify_ip("2606:4700::1111").blocked
    assert classify_ip("fe80::1").blocked and classify_ip("fc00::1").blocked
