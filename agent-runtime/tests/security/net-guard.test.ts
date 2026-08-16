import { describe, expect, it } from "vitest";

import { RuntimeError } from "../../src/errors.js";
import { assertUrlAllowed, classifyIp } from "../../src/security/net-guard.js";

// 移植自 backend/tests/test_net_guard.py：回环放行 vs 内网拒绝，基于解析 IP，不触真实 DNS。

const resolveTo =
  (...ips: string[]) =>
  async () =>
    ips;

async function expectBlocked(promise: Promise<void>, match?: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(RuntimeError);
  try {
    await promise;
  } catch (error) {
    const e = error as RuntimeError;
    expect(e.code).toBe("egress_blocked");
    expect(e.statusCode).toBe(400);
    if (match) expect(e.message).toMatch(match);
  }
}

describe("net-guard: assertUrlAllowed", () => {
  const env = {} as NodeJS.ProcessEnv;

  it("allows https to a public address", async () => {
    await assertUrlAllowed("https://api.anthropic.com/v1", {
      env,
      resolveHost: resolveTo("160.79.104.10"),
    });
  });

  it("allows http to loopback (local Ollama / LM Studio)", async () => {
    await assertUrlAllowed("http://localhost:11434/v1", {
      env,
      resolveHost: resolveTo("127.0.0.1"),
    });
    await assertUrlAllowed("http://[::1]:1234/v1", { env, resolveHost: resolveTo("::1") });
  });

  it("rejects http to a public address", async () => {
    await expectBlocked(
      assertUrlAllowed("http://evil.example.com/v1", { env, resolveHost: resolveTo("8.8.8.8") }),
      /回环/u,
    );
  });

  it("rejects https to a private address", async () => {
    await expectBlocked(
      assertUrlAllowed("https://10.0.0.5/v1", { env, resolveHost: resolveTo("10.0.0.5") }),
      /内网/u,
    );
  });

  it("judges by resolved IP, not hostname (rebinding disguise)", async () => {
    await expectBlocked(
      assertUrlAllowed("http://localhost.attacker.com/v1", {
        env,
        resolveHost: resolveTo("203.0.113.7"),
      }),
    );
  });

  it("rejects non-http schemes and malformed urls", async () => {
    await expectBlocked(assertUrlAllowed("ftp://example.com/x", { env }), /scheme/u);
    await expectBlocked(assertUrlAllowed("not a url", { env }));
  });

  it("host allowlist bypasses IP judgement", async () => {
    await assertUrlAllowed("https://gpu-box.internal:8000/v1", {
      env: { GLAUX_VLM_HOST_ALLOW: "gpu-box.internal" } as NodeJS.ProcessEnv,
      resolveHost: resolveTo("10.1.2.3"),
    });
  });

  it("blocks fake-ip range by default with a pointer to the toggle", async () => {
    await expectBlocked(
      assertUrlAllowed("https://gw.example.com/v1", { env, resolveHost: resolveTo("198.18.0.32") }),
      /GLAUX_VLM_ALLOW_FAKEIP/u,
    );
  });

  it("allows fake-ip range when toggled, but not real private ranges", async () => {
    const toggled = { GLAUX_VLM_ALLOW_FAKEIP: "1" } as NodeJS.ProcessEnv;
    await assertUrlAllowed("https://gw.example.com/v1", {
      env: toggled,
      resolveHost: resolveTo("198.18.0.32"),
    });
    await expectBlocked(
      assertUrlAllowed("https://sneaky.example.com/v1", {
        env: toggled,
        resolveHost: resolveTo("10.0.0.5"),
      }),
      /内网/u,
    );
  });

  it("rejects when any resolved address is blocked (mixed records)", async () => {
    await expectBlocked(
      assertUrlAllowed("https://mixed.example.com/v1", {
        env,
        resolveHost: resolveTo("160.79.104.10", "192.168.1.9"),
      }),
    );
  });

  it("rejects DNS failures explicitly", async () => {
    await expectBlocked(
      assertUrlAllowed("https://nope.invalid/v1", {
        env,
        resolveHost: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
      /解析失败/u,
    );
  });
});

describe("net-guard: classifyIp", () => {
  it("classifies IPv4 ranges like Python ipaddress", () => {
    expect(classifyIp("127.0.0.1")).toMatchObject({ loopback: true });
    expect(classifyIp("10.0.0.1")).toMatchObject({ blocked: true, loopback: false });
    expect(classifyIp("172.16.5.5")).toMatchObject({ blocked: true });
    expect(classifyIp("172.32.0.1")).toMatchObject({ blocked: false });
    expect(classifyIp("192.168.0.1")).toMatchObject({ blocked: true });
    expect(classifyIp("169.254.1.1")).toMatchObject({ blocked: true });
    expect(classifyIp("224.0.0.1")).toMatchObject({ blocked: true });
    expect(classifyIp("0.0.0.0")).toMatchObject({ blocked: true });
    expect(classifyIp("198.18.0.32")).toMatchObject({ fakeIp: true, blocked: true });
    expect(classifyIp("198.20.0.1")).toMatchObject({ fakeIp: false, blocked: false });
    expect(classifyIp("8.8.8.8")).toMatchObject({ blocked: false, loopback: false });
  });

  it("classifies IPv6 ranges", () => {
    expect(classifyIp("::1")).toMatchObject({ loopback: true });
    expect(classifyIp("::")).toMatchObject({ blocked: true });
    expect(classifyIp("fd00::1")).toMatchObject({ blocked: true });
    expect(classifyIp("fe80::1")).toMatchObject({ blocked: true });
    expect(classifyIp("ff02::1")).toMatchObject({ blocked: true });
    expect(classifyIp("2001:db8::1")).toMatchObject({ blocked: true });
    expect(classifyIp("2607:f8b0::1")).toMatchObject({ blocked: false });
    expect(classifyIp("::ffff:127.0.0.1")).toMatchObject({ loopback: true });
    expect(classifyIp("::ffff:10.0.0.1")).toMatchObject({ blocked: true });
  });
});
