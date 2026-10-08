#!/usr/bin/env node
/**
 * 安装后的冒烟测试（SDD 24 §7.6 规则 3）：不调用真实模型。
 *
 *   GLAUX_HOME=<数据目录> node scripts/release/smoke.mjs <glaux 命令的完整路径>
 *
 * 步骤：glaux start → 带令牌请求两个健康检查 → 无令牌请求被拒 → 经反代上传示例图片 →
 * glaux doctor → glaux stop → glaux uninstall --purge --yes。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const glaux = process.argv[2];
if (!glaux) throw new Error("usage: smoke.mjs <path to glaux command>");
const home = resolve(process.env.GLAUX_HOME || join(homedir(), ".glaux"));
const sample = join(dirname(fileURLToPath(import.meta.url)), "../../data/natural/cat.jpg");

function run(...args) {
  console.log(`$ glaux ${args.join(" ")}`);
  const result = spawnSync(glaux, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, GLAUX_NO_BROWSER: "1" } });
  if (result.status !== 0) throw new Error(`glaux ${args.join(" ")} exited with ${result.status}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

run("start");
const state = JSON.parse(readFileSync(join(home, "run", "state.json"), "utf8"));
const token = readFileSync(join(home, "run", "session.token"), "utf8").trim();
const base = `http://127.0.0.1:${state.port}`;
const auth = { "x-glaux-token": token };

expect((await fetch(`${base}/agent-api/v1/health`)).ok, "agent-runtime health");
expect((await fetch(`${base}/api/health`, { headers: auth })).ok, "backend health through the proxy");
expect((await fetch(`${base}/api/datasources`)).status === 401, "API without the session token is rejected");
expect((await fetch(`http://127.0.0.1:${state.backend_port}/datasources`)).status === 401, "backend port rejects direct access");

const form = new FormData();
form.append("files", new Blob([readFileSync(sample)], { type: "image/jpeg" }), "cat.jpg");
const upload = await fetch(`${base}/api/uploads/images`, { method: "POST", headers: auth, body: form });
expect(upload.ok, `upload a sample image (HTTP ${upload.status})`);

const page = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
expect(page.status === 303 && String(page.headers.get("set-cookie")).includes("HttpOnly"), "token login sets an HttpOnly cookie");

run("doctor");
run("stop");
run("uninstall", "--purge", "--yes");
console.log("smoke test passed");
