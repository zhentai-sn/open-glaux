#!/usr/bin/env node
/**
 * glaux 启动器（SDD 24 §7.3）：启停 backend 与 agent-runtime，并负责状态、自检、更新与卸载。
 *
 * 运行位置有两种：
 * - 安装版：<安装目录>/versions/<版本>/launcher/glaux.mjs，由 <安装目录>/runtime/node 运行；
 * - 源码目录：<仓库>/launcher/glaux.mjs（`make start`），使用 PATH 中的 node 与 uv。
 *
 * 只依赖 Node 内置模块。
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, statfsSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WIN = platform() === "win32";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // 程序包根目录
const VERSION = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
const INSTALLED = basename(dirname(ROOT)) === "versions";
const INSTALL_DIR = INSTALLED ? resolve(ROOT, "../..") : undefined;
const GLAUX_HOME = resolve(process.env.GLAUX_HOME?.trim() || join(homedir(), ".glaux"));
const RUN_DIR = join(GLAUX_HOME, "run");
const LOG_DIR = join(GLAUX_HOME, "logs");
const STATE_FILE = join(RUN_DIR, "state.json");
const SESSION_TOKEN_FILE = join(RUN_DIR, "session.token");
const DEFAULT_PORT = 7410;
const HEALTH_TIMEOUT_MS = 120_000;
const LOG_ROTATE_BYTES = 10 * 1024 * 1024;
const PAGES_BASE = "https://zhentai-sn.github.io/open-glaux";

// ---------------------------------------------------------------------------- 输出

const zh = /^zh/i.test(process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale ?? "");
const t = (cn, en) => (zh ? cn : en);
const info = (message) => process.stdout.write(`${message}\n`);
const fail = (message, code = 1) => {
  process.stderr.write(`glaux: ${message}\n`);
  process.exit(code);
};

// ---------------------------------------------------------------------------- 路径

function pythonPath() {
  const venv = join(ROOT, "backend", ".venv");
  return IS_WIN ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}

function uvPath() {
  if (INSTALL_DIR) {
    const bundled = join(INSTALL_DIR, "runtime", "uv", IS_WIN ? "uv.exe" : "uv");
    if (existsSync(bundled)) return bundled;
  }
  return "uv";
}

function port() {
  const raw = process.env.GLAUX_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) fail(t(`GLAUX_PORT 无效：${raw}`, `invalid GLAUX_PORT: ${raw}`));
  return value;
}

/** 数据目录映射（SDD 24 §9.1）；已显式设置的变量不覆盖。 */
function dataEnv() {
  const defaults = {
    GLAUX_HOME,
    GLAUX_AGENT_DATA_DIR: join(GLAUX_HOME, "agent"),
    GLAUX_DATASETS_ROOT: join(GLAUX_HOME, "datasets"),
    GLAUX_ATLAS_ROOT: join(GLAUX_HOME, "atlas"),
    GLAUX_MODELS_ROOT: join(GLAUX_HOME, "models"),
  };
  const env = {};
  for (const [key, value] of Object.entries(defaults)) env[key] = process.env[key]?.trim() || value;
  return env;
}

// ---------------------------------------------------------------------------- 状态

function ensureDirs() {
  for (const dir of [GLAUX_HOME, RUN_DIR, LOG_DIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

function writeSecret(file, value) {
  writeFileSync(file, value, { mode: 0o600 });
  if (!IS_WIN) chmodSync(file, 0o600);
}

function sessionToken() {
  if (existsSync(SESSION_TOKEN_FILE)) {
    const value = readFileSync(SESSION_TOKEN_FILE, "utf8").trim();
    if (value.length >= 32) return value;
  }
  const value = randomBytes(32).toString("hex");
  writeSecret(SESSION_TOKEN_FILE, value);
  return value;
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function healthy(url, timeoutMs = 2_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

async function running() {
  const state = readState();
  if (!state || !alive(state.agent_pid)) return undefined;
  return (await healthy(`http://127.0.0.1:${state.port}/agent-api/v1/health`)) ? state : undefined;
}

// ---------------------------------------------------------------------------- 进程

function portFree(value) {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(value, "127.0.0.1", () => server.close(() => done(true)));
  });
}

function freePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: value } = server.address();
      server.close(() => done(value));
    });
  });
}

function openLog(name) {
  const file = join(LOG_DIR, `${name}.log`);
  try {
    if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // 首次运行没有日志文件。
  }
  return openSync(file, "a");
}

function launch(name, command, args, options) {
  const log = openLog(name);
  const child = spawn(command, args, {
    ...options,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.on("error", (error) => fail(t(`无法启动 ${name}：${error.message}`, `cannot start ${name}: ${error.message}`)));
  child.unref();
  return child.pid;
}

function terminate(pid, force) {
  if (!alive(pid)) return;
  if (IS_WIN) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM"); // detached 子进程自成进程组
  } catch {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      // 已退出。
    }
  }
}

async function stopPids(pids) {
  for (const pid of pids) terminate(pid, false);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && pids.some(alive)) await new Promise((r) => setTimeout(r, 200));
  for (const pid of pids) terminate(pid, true);
}

function tailLog(name, lines = 50) {
  const file = join(LOG_DIR, `${name}.log`);
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").split(/\r?\n/u).slice(-lines - 1).join("\n");
}

// ---------------------------------------------------------------------------- 浏览器

function openBrowser(url) {
  if (process.env.GLAUX_NO_BROWSER === "1") return;
  const [command, args] = IS_WIN
    ? ["cmd", ["/c", "start", "", url]]
    : platform() === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // 无图形环境时只打印地址。
  }
}

function launchUrl(state) {
  return `http://127.0.0.1:${state.port}/?token=${sessionToken()}`;
}

// ---------------------------------------------------------------------------- 命令

async function start() {
  ensureDirs();
  const current = await running();
  if (current) {
    info(t(`Glaux 已在运行：http://127.0.0.1:${current.port}/`, `Glaux is already running: http://127.0.0.1:${current.port}/`));
    openBrowser(launchUrl(current));
    return;
  }
  const stale = readState();
  if (stale) await stopPids([stale.agent_pid, stale.backend_pid].filter(Boolean));

  const agentPort = port();
  if (!(await portFree(agentPort))) {
    fail(t(
      `端口 ${agentPort} 已被占用。换一个端口：GLAUX_PORT=<端口> glaux start`,
      `port ${agentPort} is in use. Pick another: GLAUX_PORT=<port> glaux start`,
    ));
  }
  for (const [label, path] of [
    ["Python", pythonPath()],
    ["frontend", join(ROOT, "frontend", "dist", "index.html")],
    ["agent-runtime", join(ROOT, "agent-runtime", "dist", "index.js")],
  ]) {
    if (!existsSync(path)) fail(t(`缺少 ${label}：${path}。运行 glaux doctor 检查安装。`, `missing ${label}: ${path}. Run glaux doctor.`));
  }

  const backendPort = await freePort();
  const backendToken = randomBytes(32).toString("hex");
  const token = sessionToken();
  const data = dataEnv();
  for (const dir of Object.values(data)) mkdirSync(dir, { recursive: true });
  const common = { ...process.env, ...data, GLAUX_VERSION: VERSION };

  const backendPid = launch("backend", pythonPath(), [
    "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort), "--no-access-log",
  ], {
    cwd: join(ROOT, "backend"),
    env: { ...common, GLAUX_BACKEND_TOKEN: backendToken, PYTHONUNBUFFERED: "1" },
  });
  const agentPid = launch("agent-runtime", process.execPath, [join(ROOT, "agent-runtime", "dist", "index.js")], {
    cwd: join(ROOT, "agent-runtime"),
    env: {
      ...common,
      GLAUX_AGENT_HOST: "127.0.0.1",
      GLAUX_AGENT_PORT: String(agentPort),
      GLAUX_SERVE_STATIC: join(ROOT, "frontend", "dist"),
      GLAUX_SESSION_TOKEN: token,
      GLAUX_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      GLAUX_BACKEND_TOKEN: backendToken,
    },
  });
  const state = {
    version: VERSION,
    port: agentPort,
    backend_port: backendPort,
    agent_pid: agentPid,
    backend_pid: backendPid,
    started_at: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  info(t("正在启动 Glaux…", "Starting Glaux…"));
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    if (!alive(agentPid) || !alive(backendPid)) break;
    if (
      (await healthy(`http://127.0.0.1:${backendPort}/health`)) &&
      (await healthy(`http://127.0.0.1:${agentPort}/agent-api/v1/health`))
    ) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    await stopPids([agentPid, backendPid]);
    rmSync(STATE_FILE, { force: true });
    process.stderr.write(`\n--- backend.log ---\n${tailLog("backend")}\n--- agent-runtime.log ---\n${tailLog("agent-runtime")}\n`);
    fail(t("启动失败，见上方日志；运行 glaux doctor 检查环境。", "startup failed; see the logs above and run glaux doctor."));
  }
  info(t(`Glaux 已就绪：http://127.0.0.1:${agentPort}/`, `Glaux is ready: http://127.0.0.1:${agentPort}/`));
  info(t("关闭浏览器不会停止 Glaux；运行 glaux stop 停止。", "Closing the browser does not stop Glaux. Run glaux stop to stop it."));
  openBrowser(launchUrl(state));
}

async function stop() {
  const state = readState();
  if (!state) {
    info(t("Glaux 未在运行。", "Glaux is not running."));
    return;
  }
  await stopPids([state.agent_pid, state.backend_pid].filter(Boolean));
  rmSync(STATE_FILE, { force: true });
  info(t("Glaux 已停止。", "Glaux stopped."));
}

async function open() {
  const state = await running();
  if (!state) {
    await start();
    return;
  }
  const url = launchUrl(state);
  info(`http://127.0.0.1:${state.port}/`);
  openBrowser(url);
}

async function status() {
  const state = await running();
  info(`Glaux ${VERSION}${INSTALLED ? "" : " (source)"}`);
  info(`GLAUX_HOME ${GLAUX_HOME}`);
  if (!state) {
    info(t("状态：已停止", "status: stopped"));
    return;
  }
  const backendOk = await healthy(`http://127.0.0.1:${state.backend_port}/health`);
  info(t("状态：运行中", "status: running"));
  info(`url http://127.0.0.1:${state.port}/`);
  info(`agent-runtime pid ${state.agent_pid} ok`);
  info(`backend pid ${state.backend_pid} ${backendOk ? "ok" : "unhealthy"}`);
  info(`started ${state.started_at}`);
}

function findBash() {
  if (!IS_WIN) return spawnSync("bash", ["-c", "exit 0"]).status === 0 ? "bash" : undefined;
  const candidates = [
    process.env.GLAUX_BASH,
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

async function doctor() {
  const checks = [];
  const add = (name, ok, hint) => checks.push({ name, ok, hint });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add(`Node ${process.versions.node}`, nodeMajor >= 22, t("需要 Node 22.19 或更高", "Node 22.19+ is required"));
  const python = pythonPath();
  const pyOk = existsSync(python) && spawnSync(python, ["-c", "import fastapi, numpy"], { stdio: "ignore" }).status === 0;
  add(t("Python 环境", "Python environment"), pyOk, t("重新运行安装脚本或 glaux update", "re-run the installer or glaux update"));
  const avOk = pyOk && spawnSync(python, ["-c", "import av"], { stdio: "ignore" }).status === 0;
  add(t("视频解码（PyAV）", "video decoding (PyAV)"), avOk, t("视频功能不可用；重新运行安装脚本", "video is unavailable; re-run the installer"));
  add("bash", Boolean(findBash()), IS_WIN
    ? t("安装 Git for Windows：winget install Git.Git", "install Git for Windows: winget install Git.Git")
    : t("安装 bash", "install bash"));
  add(t("前端文件", "frontend files"), existsSync(join(ROOT, "frontend", "dist", "index.html")), t("重新安装", "reinstall"));
  add("agent-runtime", existsSync(join(ROOT, "agent-runtime", "dist", "index.js")), t("重新安装", "reinstall"));
  const state = await running();
  const agentPort = port();
  add(t(`端口 ${agentPort}`, `port ${agentPort}`), Boolean(state) || (await portFree(agentPort)), t("设置 GLAUX_PORT 换端口", "set GLAUX_PORT"));
  let writable = true;
  try {
    ensureDirs();
    const probe = join(RUN_DIR, ".probe");
    writeFileSync(probe, "");
    unlinkSync(probe);
  } catch {
    writable = false;
  }
  add(t(`数据目录 ${GLAUX_HOME}`, `data directory ${GLAUX_HOME}`), writable, t("检查目录权限", "check permissions"));
  const free = statfsFree(GLAUX_HOME);
  if (free !== undefined) add(t(`可用磁盘 ${(free / 2 ** 30).toFixed(1)} GB`, `free disk ${(free / 2 ** 30).toFixed(1)} GB`), free > 2 ** 30, t("至少保留 1 GB", "keep at least 1 GB free"));

  for (const check of checks) info(`${check.ok ? "✓" : "✗"} ${check.name}${check.ok ? "" : ` — ${check.hint}`}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

function statfsFree(path) {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}

function logs(args) {
  const lines = Number.parseInt(args[0] ?? "100", 10) || 100;
  for (const name of ["launcher", "backend", "agent-runtime"]) {
    const text = tailLog(name, lines);
    if (text) info(`--- ${name}.log ---\n${text}`);
  }
}

// ---------------------------------------------------------------------------- 更新与卸载

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function logLauncher(message) {
  try {
    ensureDirs();
    writeFileSync(join(LOG_DIR, "launcher.log"), `${new Date().toISOString()} ${message}\n`, { flag: "a" });
  } catch {
    // 日志失败不影响命令。
  }
}

async function update() {
  if (!INSTALL_DIR) fail(t("源码目录请用 git pull 更新。", "Use git pull in a source checkout."));
  const base = process.env.GLAUX_UPDATE_URL?.trim() || `${PAGES_BASE}/latest.json`;
  const latest = await (await fetch(base, { signal: AbortSignal.timeout(30_000) })).json();
  if (compareVersions(latest.version, VERSION) <= 0) {
    info(t(`已是最新版本 ${VERSION}。`, `Already up to date (${VERSION}).`));
    return;
  }
  const asset = latest.assets?.["tar.gz"];
  if (!asset?.url || !asset?.sha256) fail(t("latest.json 缺少程序包信息。", "latest.json has no package entry."));
  info(t(`正在更新 ${VERSION} → ${latest.version}…`, `Updating ${VERSION} → ${latest.version}…`));
  logLauncher(`update ${VERSION} -> ${latest.version}`);

  const work = join(tmpdir(), `glaux-update-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const archive = join(work, "glaux.tar.gz");
  const response = await fetch(process.env.GLAUX_DOWNLOAD_BASE ? `${process.env.GLAUX_DOWNLOAD_BASE.replace(/\/+$/u, "")}/${basename(new URL(asset.url).pathname)}` : asset.url);
  if (!response.ok) fail(t(`下载失败：HTTP ${response.status}`, `download failed: HTTP ${response.status}`));
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  if ((await sha256(archive)) !== asset.sha256) {
    rmSync(work, { recursive: true, force: true });
    fail(t("SHA256 校验失败，已删除下载文件。", "SHA256 mismatch; the download was removed."));
  }

  const target = join(INSTALL_DIR, "versions", latest.version);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const untar = spawnSync("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], { stdio: "inherit" });
  if (untar.status !== 0) fail(t("解压失败。", "extraction failed."));
  const sync = spawnSync(uvPath(), ["sync", "--frozen", "--no-dev", "--no-install-project", "--extra", "video", "--project", join(target, "backend")], {
    stdio: "inherit",
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: join(target, "backend", ".venv") },
  });
  if (sync.status !== 0) {
    rmSync(target, { recursive: true, force: true });
    fail(t("Python 依赖安装失败，旧版本保持不变。", "installing Python dependencies failed; the current version is unchanged."));
  }

  const wasRunning = Boolean(await running());
  if (wasRunning) await stop();
  switchCurrent(target);
  rmSync(work, { recursive: true, force: true });
  pruneVersions(latest.version);
  logLauncher(`updated to ${latest.version}`);
  info(t(`已更新到 ${latest.version}。`, `Updated to ${latest.version}.`));
  if (wasRunning) {
    const next = spawnSync(process.execPath, [join(target, "launcher", "glaux.mjs"), "start"], { stdio: "inherit" });
    process.exitCode = next.status ?? 0;
  }
}

function switchCurrent(target) {
  const link = join(INSTALL_DIR, "current");
  const temp = `${link}.new`;
  rmSync(temp, { recursive: true, force: true });
  symlinkSync(target, temp, IS_WIN ? "junction" : "dir");
  if (IS_WIN) rmSync(link, { recursive: true, force: true });
  renameSync(temp, link);
}

function pruneVersions(keep) {
  const dir = join(INSTALL_DIR, "versions");
  const versions = readdirSync(dir).filter((name) => /^\d+\.\d+\.\d+/u.test(name)).sort(compareVersions);
  for (const name of versions.slice(0, -2)) {
    if (name !== keep && name !== VERSION) rmSync(join(dir, name), { recursive: true, force: true });
  }
}

function shimPaths() {
  if (IS_WIN) {
    return [join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Glaux.lnk"),
      join(homedir(), "Desktop", "Glaux.lnk")];
  }
  return [
    join(homedir(), ".local", "bin", "glaux"),
    join(homedir(), ".local", "share", "applications", "glaux.desktop"),
    join(homedir(), "Applications", "Glaux.app"),
  ];
}

async function uninstall(args) {
  if (!INSTALL_DIR) fail(t("源码目录无需卸载。", "Nothing to uninstall in a source checkout."));
  const purge = args.includes("--purge");
  if (purge && !args.includes("--yes")) {
    const answer = await prompt(t(`将删除全部数据 ${GLAUX_HOME}，输入 yes 确认：`, `This deletes all data in ${GLAUX_HOME}. Type yes to confirm: `));
    if (answer.trim().toLowerCase() !== "yes") fail(t("已取消。", "Cancelled."), 0);
  }
  await stop();
  for (const path of shimPaths()) rmSync(path, { recursive: true, force: true });
  if (IS_WIN) removeFromUserPath(join(INSTALL_DIR, "bin"));
  if (purge) rmSync(GLAUX_HOME, { recursive: true, force: true });
  info(purge
    ? t("Glaux 及全部数据已删除。", "Glaux and all data were removed.")
    : t(`Glaux 已卸载，数据保留在 ${GLAUX_HOME}。`, `Glaux was uninstalled. Data remains in ${GLAUX_HOME}.`));
  removeInstallDir();
}

function removeInstallDir() {
  if (!IS_WIN) {
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    return;
  }
  // Windows 无法删除正在运行的 node.exe 所在目录：交给退出后执行的 cmd。
  const script = join(tmpdir(), `glaux-uninstall-${process.pid}.cmd`);
  writeFileSync(script, `@echo off\r\nping -n 3 127.0.0.1 >nul\r\nrmdir /s /q "${INSTALL_DIR}"\r\ndel "%~f0"\r\n`);
  spawn("cmd", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function removeFromUserPath(dir) {
  const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if($p){ $n=($p -split ';' | Where-Object { $_ -and $_ -ne '${dir.replace(/'/gu, "''")}' }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n,'User') }`;
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
}

function prompt(question) {
  process.stdout.write(question);
  return new Promise((done) => {
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      done(String(data));
    });
  });
}

// ---------------------------------------------------------------------------- 入口

const HELP = t(`用法：glaux <命令>

  start       启动并打开浏览器（缺省）
  stop        停止
  status      查看状态
  open        打开浏览器（未运行时先启动）
  logs [行数] 查看日志
  doctor      检查运行环境
  update      更新到最新版本
  uninstall   卸载程序，保留数据（--purge 同时删除数据）
  version     显示版本`, `Usage: glaux <command>

  start       start and open the browser (default)
  stop        stop
  status      show status
  open        open the browser (starts Glaux if needed)
  logs [n]    show logs
  doctor      check the environment
  update      update to the latest version
  uninstall   remove the program, keep data (--purge also removes data)
  version     show the version`);

const [command = "start", ...rest] = process.argv.slice(2);
const commands = {
  start, stop, status, open, doctor, update,
  logs: () => logs(rest),
  uninstall: () => uninstall(rest),
  version: () => info(VERSION),
  help: () => info(HELP),
  "--help": () => info(HELP),
  "-h": () => info(HELP),
};
if (!commands[command]) fail(`${t("未知命令", "unknown command")}: ${command}\n\n${HELP}`, 2);
try {
  await commands[command]();
} catch (error) {
  logLauncher(`${command} failed: ${error?.stack ?? error}`);
  fail(error?.message ?? String(error));
}
