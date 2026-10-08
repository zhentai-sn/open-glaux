#!/usr/bin/env node
/**
 * 安装后冒烟（SDD 24 §7.6）：启停、安全、上传、更新保留数据、卸载，不调用模型。
 * GLAUX_HOME=... GLAUX_INSTALL_DIR=... node smoke.mjs <glaux 命令> [本次 tar.gz]
 * 传入归档时，将隔离安装的版本声明降为 0.0.0，再通过本机 manifest 升级到发布包。
 * 验证真实下载、解压、切换与重启链路，不代表旧数据库版本迁移验收。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const glaux = process.argv[2];
if (!glaux) throw new Error("usage: smoke.mjs <glaux command> [release tar.gz]");
const archive = process.argv[3] && resolve(process.argv[3]);
const home = resolve(process.env.GLAUX_HOME || join(homedir(), ".glaux"));
const installDir = process.env.GLAUX_INSTALL_DIR && resolve(process.env.GLAUX_INSTALL_DIR);
const sample = join(dirname(fileURLToPath(import.meta.url)), "../../data/natural/cat.jpg");
const win = process.platform === "win32";
let version;

function run(...args) {
  console.log(`$ glaux ${args.join(" ")}`);
  return new Promise((done, reject) => {
    const child = spawn(win ? `"${glaux}"` : glaux, args, { stdio: "inherit", shell: win, env: { ...process.env, GLAUX_NO_BROWSER: "1" } });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done() : reject(new Error(`glaux ${args.join(" ")} exited with ${code}`)));
  });
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}
function connection() {
  const state = JSON.parse(readFileSync(join(home, "run", "state.json"), "utf8"));
  const token = readFileSync(join(home, "run", "session.token"), "utf8").trim();
  return { state, token, base: `http://127.0.0.1:${state.port}`, auth: { "x-glaux-token": token } };
}
if (archive) {
  if (!process.env.GLAUX_HOME || !installDir) throw new Error("update smoke requires an isolated GLAUX_HOME and GLAUX_INSTALL_DIR");
  const current = join(installDir, "current");
  const root = realpathSync(current);
  version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const previous = join(installDir, "versions", "0.0.0");
  expect(!existsSync(previous), "isolated prior-version directory is unused");
  (win ? rmdirSync : unlinkSync)(current);
  renameSync(root, previous);
  writeFileSync(join(previous, "VERSION"), "0.0.0\n");
  symlinkSync(previous, current, win ? "junction" : "dir");
}

await run("start");
let { state, token, base, auth } = connection();
expect((await fetch(`${base}/agent-api/v1/health`)).ok, "agent-runtime health");
expect((await fetch(`${base}/api/health`, { headers: auth })).ok, "backend health through the proxy");
expect((await fetch(`${base}/api/datasources`)).status === 401, "API without the session token is rejected");
expect((await fetch(`http://127.0.0.1:${state.backend_port}/datasources`)).status === 401, "backend port rejects direct access");
const form = new FormData();
form.append("files", new Blob([readFileSync(sample)], { type: "image/jpeg" }), "cat.jpg");
const upload = await fetch(`${base}/api/uploads/images`, { method: "POST", headers: auth, body: form });
if (!upload.ok) {
  console.error(`upload response: ${await upload.text()}`);
  await run("logs", "100");
}
expect(upload.ok, `upload a sample image (HTTP ${upload.status})`);
const uploaded = await upload.json();
const page = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
expect(page.status === 303 && String(page.headers.get("set-cookie")).includes("HttpOnly"), "token login sets an HttpOnly cookie");

if (archive) {
  const marker = join(home, "smoke-preserve.json");
  writeFileSync(marker, JSON.stringify({ uploaded }));
  const saved = readFileSync(marker, "utf8");
  const sourcesBefore = await (await fetch(`${base}/api/datasources`, { headers: auth })).json();
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const server = createServer((request, response) => {
    if (request.url === "/latest.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ version, assets: { "tar.gz": { url: `http://127.0.0.1:${server.address().port}/package.tar.gz`, sha256: digest } } }));
    } else if (request.url === "/package.tar.gz") createReadStream(archive).pipe(response);
    else response.writeHead(404).end();
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const oldUpdateUrl = process.env.GLAUX_UPDATE_URL;
  process.env.GLAUX_UPDATE_URL = `http://127.0.0.1:${server.address().port}/latest.json`;
  try { await run("update"); }
  finally {
    if (oldUpdateUrl === undefined) delete process.env.GLAUX_UPDATE_URL;
    else process.env.GLAUX_UPDATE_URL = oldUpdateUrl;
    await new Promise(done => server.close(done));
  }
  ({ state, token, base, auth } = connection());
  expect(readFileSync(join(installDir, "current", "VERSION"), "utf8").trim() === version, "update switched to the released version");
  expect(readFileSync(marker, "utf8") === saved, "update preserved user data");
  expect((await fetch(`${base}/api/health`, { headers: auth })).ok, "updated backend restarted successfully");
  const sourcesAfter = await (await fetch(`${base}/api/datasources`, { headers: auth })).json();
  expect(sourcesBefore.every(source => sourcesAfter.some(next => next.id === source.id)), "update preserved uploaded data sources");
  await run("status");
}
await run("doctor");
await run("stop");
await run("uninstall", "--purge", "--yes");
expect(!existsSync(home), "purge removed isolated user data");
console.log("smoke test passed");
