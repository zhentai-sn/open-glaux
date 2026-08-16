/**
 * 出站 SSRF 守卫——向**用户提供的 base_url** 发请求前调用。
 *
 * 移植自 backend/app/net_guard.py（退役 orchestration P2；SDD 02 §8「出站守卫（Node）」）。
 * 规则与 Python 版逐条对齐：
 * - scheme 仅 http/https；http 只放行解析到**回环**的 host（本地 Ollama / LM Studio）。
 * - 判定基于 **DNS 解析后的 IP**（防 localhost.attacker.com / rebinding），不看字符串。
 * - 回环放行；其它私网 / 链路本地 / 保留 / 组播 / 未指定地址一律拒，除非：
 *   - host 命中 GLAUX_VLM_HOST_ALLOW（逗号分隔，显式白名单，部署方自担）；
 *   - IP 落在 fake-ip 段 198.18.0.0/15 且 GLAUX_VLM_ALLOW_FAKEIP 打开（透明代理用户）。
 *
 * 残留风险同 Python 版：解析在此、fetch 时再解析一次 = TOCTOU（rebinding 仍有缝）；
 * 待安全评审后把解析到的 IP 钉进连接。
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { RuntimeError } from "../errors.js";

export type ResolveHost = (host: string) => Promise<string[]>;

export interface NetGuardOptions {
  resolveHost?: ResolveHost;
  env?: NodeJS.ProcessEnv;
}

const defaultResolve: ResolveHost = async (host) => {
  if (isIP(host)) return [host];
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

function hostAllowlist(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env.GLAUX_VLM_HOST_ALLOW ?? "";
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

function allowFakeIp(env: NodeJS.ProcessEnv): boolean {
  const v = (env.GLAUX_VLM_ALLOW_FAKEIP ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ---- IP 分类（对齐 Python ipaddress 的 is_* 属性，只覆盖守卫需要的判定） ----

interface IpClass {
  loopback: boolean;
  fakeIp: boolean; // 198.18.0.0/15
  blocked: boolean; // private | link_local | reserved | multicast | unspecified
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".").map((p) => Number(p));
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

function classifyV4(ip: string): IpClass {
  const p = parseV4(ip);
  if (!p) return { loopback: false, fakeIp: false, blocked: true };
  const [a, b] = p as [number, number, number, number];
  const loopback = a === 127;
  const fakeIp = a === 198 && (b === 18 || b === 19);
  const priv =
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10（Python is_private=True）
    (a === 192 && b === 0 && p[2] === 0) || // 192.0.0.0/24
    (a === 192 && b === 0 && p[2] === 2) || // TEST-NET-1
    (a === 198 && b === 51 && p[2] === 100) || // TEST-NET-2
    (a === 203 && b === 0 && p[2] === 113) || // TEST-NET-3
    fakeIp; // 198.18/15 在 Python 里 is_private=True
  const linkLocal = a === 169 && b === 254;
  const reserved = a >= 240; // 240.0.0.0/4（含 255.255.255.255）
  const multicast = a >= 224 && a <= 239;
  const unspecified = a === 0 && b === 0 && p[2] === 0 && p[3] === 0;
  return {
    loopback,
    fakeIp,
    blocked: priv || linkLocal || reserved || multicast || unspecified,
  };
}

function expandV6(ip: string): number[] | null {
  // 去掉 IPv4 映射尾巴（::ffff:1.2.3.4）由调用方处理；此处只展开纯 v6。
  const [head = "", tail = ""] = ip.split("::");
  const heads = head ? head.split(":") : [];
  const tails = tail ? tail.split(":") : [];
  if (ip.includes("::")) {
    const missing = 8 - heads.length - tails.length;
    if (missing < 0) return null;
    const words = [...heads, ...Array(missing).fill("0"), ...tails];
    return words.map((w) => Number.parseInt(w || "0", 16));
  }
  if (heads.length !== 8) return null;
  return heads.map((w) => Number.parseInt(w, 16));
}

function classifyV6(ip: string): IpClass {
  // IPv4 映射：::ffff:a.b.c.d → 按 v4 判
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(ip);
  if (mapped?.[1]) return classifyV4(mapped[1]);
  const w = expandV6(ip.replace(/%.*$/u, ""));
  if (!w || w.length !== 8) return { loopback: false, fakeIp: false, blocked: true };
  const allZero = w.every((x) => x === 0);
  const loopback = w.slice(0, 7).every((x) => x === 0) && w[7] === 1;
  const unspecified = allZero;
  const uniqueLocal = (w[0]! & 0xfe00) === 0xfc00; // fc00::/7
  const linkLocal = (w[0]! & 0xffc0) === 0xfe80; // fe80::/10
  const multicast = (w[0]! & 0xff00) === 0xff00; // ff00::/8
  const docs = w[0] === 0x2001 && w[1] === 0x0db8; // 2001:db8::/32（Python is_private）
  const reserved = !(
    (w[0]! & 0xe000) === 0x2000 || // 2000::/3 全球单播
    uniqueLocal ||
    linkLocal ||
    multicast ||
    loopback ||
    unspecified
  ); // 其它段 Python 视作 reserved
  return {
    loopback,
    fakeIp: false,
    blocked: unspecified || uniqueLocal || linkLocal || multicast || docs || reserved,
  };
}

export function classifyIp(ip: string): IpClass {
  const v = isIP(ip);
  if (v === 4) return classifyV4(ip);
  if (v === 6) return classifyV6(ip);
  return { loopback: false, fakeIp: false, blocked: true };
}

/**
 * URL 不满足策略即抛 `RuntimeError("egress_blocked", …, 400)`；满足则静默返回。
 */
export async function assertUrlAllowed(
  url: string,
  options: NetGuardOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const resolveHost = options.resolveHost ?? defaultResolve;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeError("egress_blocked", `base_url 无法解析：${url}`, 400);
  }
  const scheme = parsed.protocol.replace(/:$/u, "");
  if (scheme !== "http" && scheme !== "https") {
    throw new RuntimeError(
      "egress_blocked",
      `scheme 不允许：${scheme || "(空)"}（仅 http/https）`,
      400,
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, "");
  if (!host) throw new RuntimeError("egress_blocked", "URL 缺 host", 400);

  if (hostAllowlist(env).has(host.toLowerCase())) return; // 显式白名单

  let ips: string[];
  try {
    ips = await resolveHost(host);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RuntimeError("egress_blocked", `host 解析失败：${host}（${reason}）`, 400);
  }
  if (!ips.length) throw new RuntimeError("egress_blocked", `host 无解析结果：${host}`, 400);

  const classes = ips.map(classifyIp);
  const allLoopback = classes.every((c) => c.loopback);
  if (scheme === "http" && !allLoopback) {
    throw new RuntimeError(
      "egress_blocked",
      "http 仅允许回环地址（本地部署）；远端请用 https",
      400,
    );
  }

  const fakeIpOk = allowFakeIp(env);
  ips.forEach((ip, i) => {
    const c = classes[i]!;
    if (c.loopback) return;
    if (fakeIpOk && c.fakeIp) return;
    if (c.blocked) {
      const hint = c.fakeIp ? "GLAUX_VLM_ALLOW_FAKEIP" : "GLAUX_VLM_HOST_ALLOW";
      throw new RuntimeError(
        "egress_blocked",
        `拒绝内网/保留地址：${ip}（如需请配 ${hint}）`,
        400,
      );
    }
  });
}
