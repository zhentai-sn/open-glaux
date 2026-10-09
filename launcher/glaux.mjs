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
  readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statfsSync, statSync, symlinkSync, unlinkSync, writeFileSync,
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
if (IS_WIN && INSTALL_DIR) {
  const runtimeTemp = join(INSTALL_DIR, "runtime", "temp");
  mkdirSync(runtimeTemp, { recursive: true });
  process.env.TEMP = runtimeTemp;
  process.env.TMP = runtimeTemp;
}
let savedHome;
if (INSTALL_DIR && existsSync(join(INSTALL_DIR, "install.json"))) {
  savedHome = JSON.parse(readFileSync(join(INSTALL_DIR, "install.json"), "utf8")).home;
}
const GLAUX_HOME = resolve(process.env.GLAUX_HOME?.trim() || savedHome || join(homedir(), ".glaux"));
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

/**
 * Windows：libuv 以继承句柄的方式创建子进程，后台服务会一直持有启动器的标准输出；
 * 调用方捕获输出时（CI、管道）就等不到结束。改由 Start-Process（ShellExecute，不继承句柄）
 * 启动 cmd，日志由 cmd 自己重定向。返回 cmd 的 PID，停止时按进程树结束。
 */
function launchWindows(name, command, args, options) {
  closeSync(openLog(name)); // 滚动并确保日志文件存在
  const log = join(LOG_DIR, `${name}.log`);
  const commandLine = [command, ...args].map((part) => `"${part}"`).join(" ");
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$a = @{ FilePath = 'cmd.exe'; WindowStyle = 'Hidden'; PassThru = $true; WorkingDirectory = ${psQuote(options.cwd)};` +
      ` ArgumentList = ${psQuote(`/d /s /c "${commandLine} >> "${log}" 2>&1"`)} }`,
    "(Start-Process @a).Id",
  ].join("\n");
  const result = spawnSync("powershell", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
  ], { env: options.env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const pid = Number.parseInt(result.stdout.trim(), 10);
  if (result.status !== 0 || !Number.isInteger(pid)) {
    fail(t(`无法启动 ${name}：${result.stderr}`, `cannot start ${name}: ${result.stderr}`));
  }
  return pid;
}

function launch(name, command, args, options) {
  if (IS_WIN) return launchWindows(name, command, args, options);
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
  logLauncher(`start ${VERSION} port=${agentPort}`);

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
  logLauncher("stop");
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
  // 与 agent-runtime 的 workspace/shell-path.ts 同一顺序：显式变量 → 常见安装位置 → PATH 上 git.exe 所在的 Git 根目录。
  if (process.env.GLAUX_BASH?.trim()) return process.env.GLAUX_BASH.trim();
  const roots = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git"),
  ].filter(Boolean);
  const where = spawnSync("where", ["git.exe"], { encoding: "utf8", windowsHide: true });
  for (const git of (where.stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)) {
    const dir = dirname(git);
    roots.push(/\\mingw64\\bin$/iu.test(dir) ? dirname(dirname(dir)) : dirname(dir));
  }
  return roots.map((root) => join(root, "bin", "bash.exe")).find((path) => existsSync(path));
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

/** `GLAUX_MIRROR=cn` 时 PyPI 与 Python 下载走国内镜像（SDD 24 §7.7 规则 5）。 */
function mirrorEnv() {
  if (process.env.GLAUX_MIRROR !== "cn") return {};
  return {
    UV_DEFAULT_INDEX: process.env.UV_DEFAULT_INDEX || "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple",
    UV_PYTHON_INSTALL_MIRROR:
      process.env.UV_PYTHON_INSTALL_MIRROR || "https://registry.npmmirror.com/-/binary/python-build-standalone",
  };
}

function step(message) {
  info(`→ ${message}`);
  logLauncher(message);
}

function runOrFail(command, commandArgs, options, message) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(message);
}

/**
 * 安装版的共用步骤（安装脚本与 update 都调用新版本自己的 install）：
 * Python 环境 → 导入自检 → 命令入口与快捷方式 → 切换 current → 清理旧版本。
 */
async function install(args) {
  if (!INSTALL_DIR) fail(t("源码目录不需要 install。", "install is only for installed copies."));
  const restart = args.includes("--restart");
  const runtime = join(INSTALL_DIR, "runtime");
  const env = {
    ...process.env,
    ...mirrorEnv(),
    UV_PYTHON_INSTALL_DIR: join(runtime, "python"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_CACHE_DIR: process.env.UV_CACHE_DIR?.trim() || join(runtime, "cache"),
    ...(IS_WIN ? { TEMP: join(runtime, "temp"), TMP: join(runtime, "temp") } : {}),
  };
  if (IS_WIN) mkdirSync(env.TEMP, { recursive: true });
  const backend = join(ROOT, "backend");
  try {
    if (!existsSync(pythonPath())) {
      step(t("创建 Python 环境", "creating the Python environment"));
      runOrFail(uvPath(), ["venv", "--python", "3.12", join(backend, ".venv")], { env }, t("创建 Python 环境失败", "creating the Python environment failed"));
    }
    step(t("安装 Python 依赖", "installing Python dependencies"));
    runOrFail(uvPath(), [
      "pip", "install", "--python", pythonPath(), "--require-hashes", "--no-deps",
      "-r", join(backend, "requirements.lock.txt"),
    ], { env }, t("安装 Python 依赖失败；检查网络，或设置 GLAUX_MIRROR=cn 后重试", "installing Python dependencies failed; check the network or retry with GLAUX_MIRROR=cn"));
    runOrFail(pythonPath(), ["-c", "import app.main"], { cwd: backend, env: { ...process.env, GLAUX_HOME } },
      t("backend 自检失败", "backend self-check failed"));
  } catch (error) {
    const current = currentTarget();
    if (current && resolve(current) !== ROOT) rmSync(ROOT, { recursive: true, force: true });
    throw error;
  }

  writeFileSync(join(INSTALL_DIR, "install.json"), `${JSON.stringify({ home: GLAUX_HOME }, null, 2)}\n`);
  if (process.env.GLAUX_NO_SHORTCUTS === "1") {
    writeCommand();
  } else {
    step(t("写入 glaux 命令与快捷方式", "writing the glaux command and shortcuts"));
    writeShims();
  }
  const wasRunning = Boolean(await running());
  if (wasRunning) await stop();
  switchCurrent(ROOT);
  pruneVersions(VERSION);
  logLauncher(`installed ${VERSION}`);
  info(t(`Glaux ${VERSION} 已安装到 ${INSTALL_DIR}`, `Glaux ${VERSION} is installed in ${INSTALL_DIR}`));
  if (restart && wasRunning) await start();
}

function currentTarget() {
  try {
    return realpathSync(join(INSTALL_DIR, "current"));
  } catch {
    return undefined;
  }
}

function nodeBinary() {
  return IS_WIN ? join(INSTALL_DIR, "runtime", "node", "node.exe") : join(INSTALL_DIR, "runtime", "node", "bin", "node");
}

function powershell(script) {
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
}

const psQuote = (value) => `'${value.replace(/'/gu, "''")}'`;

/** <安装目录>/bin 下的 glaux 命令；`GLAUX_NO_SHORTCUTS=1`（CI 与测试）时只写这一项，不动 PATH、快捷方式与 ~/.local/bin。 */
function writeCommand() {
  const bin = join(INSTALL_DIR, "bin");
  mkdirSync(bin, { recursive: true });
  const entry = join(INSTALL_DIR, "current", "launcher", "glaux.mjs");
  if (IS_WIN) {
    writeFileSync(join(bin, "glaux.cmd"), `@echo off\r\n"%~dp0..\\runtime\\node\\node.exe" "%~dp0..\\current\\launcher\\glaux.mjs" %*\r\n`);
    return;
  }
  const shim = join(bin, "glaux");
  writeFileSync(shim, `#!/bin/sh\nexec "${nodeBinary()}" "${entry}" "$@"\n`, { mode: 0o755 });
  chmodSync(shim, 0o755);
}

function writeShims() {
  writeCommand();
  const bin = join(INSTALL_DIR, "bin");
  const entry = join(INSTALL_DIR, "current", "launcher", "glaux.mjs");
  if (IS_WIN) {
    const helper = join(ROOT, "launcher", "windows", "install-desktop.ps1");
    if (existsSync(helper)) {
      const result = powershell(`& ${psQuote(helper)} -InstallDir ${psQuote(INSTALL_DIR)} -HomeDir ${psQuote(GLAUX_HOME)}`);
      if (result.status !== 0) fail(t(`桌面入口创建失败：${result.stderr}`, `creating the desktop entry failed: ${result.stderr}`));
      return;
    }
    const result = powershell([
      `$shell = New-Object -ComObject WScript.Shell`,
      `foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {`,
      `  $link = $shell.CreateShortcut((Join-Path $dir 'Glaux.lnk'))`,
      `  $link.TargetPath = ${psQuote(nodeBinary())}`,
      `  $link.Arguments = ${psQuote(`"${entry}" open`)}`,
      `  $link.WorkingDirectory = ${psQuote(INSTALL_DIR)}`,
      `  $link.WindowStyle = 7`,
      `  $link.Description = 'Glaux'`,
      `  $link.Save()`,
      `}`,
      `$p = [Environment]::GetEnvironmentVariable('Path', 'User')`,
      `$parts = @($p -split ';' | Where-Object { $_ })`,
      `if ($parts -notcontains ${psQuote(bin)}) { [Environment]::SetEnvironmentVariable('Path', (($parts + ${psQuote(bin)}) -join ';'), 'User') }`,
    ].join("\n"));
    if (result.status !== 0) info(t(`快捷方式创建失败：${result.stderr}`, `creating shortcuts failed: ${result.stderr}`));
    return;
  }

  const shim = join(bin, "glaux");
  const localBin = join(homedir(), ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const link = join(localBin, "glaux");
  rmSync(link, { force: true });
  symlinkSync(shim, link);

  if (platform() === "darwin") {
    const app = join(homedir(), "Applications", "Glaux.app", "Contents");
    rmSync(dirname(app), { recursive: true, force: true });
    mkdirSync(join(app, "MacOS"), { recursive: true });
    writeFileSync(join(app, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Glaux</string>
<key>CFBundleIdentifier</key><string>io.github.zhentai-sn.glaux</string>
<key>CFBundleExecutable</key><string>Glaux</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${VERSION}</string>
<key>LSUIElement</key><true/>
</dict></plist>
`);
    writeFileSync(join(app, "MacOS", "Glaux"), `#!/bin/sh\nexec "${shim}" open\n`, { mode: 0o755 });
    chmodSync(join(app, "MacOS", "Glaux"), 0o755);
  } else {
    const applications = join(homedir(), ".local", "share", "applications");
    mkdirSync(applications, { recursive: true });
    writeFileSync(join(applications, "glaux.desktop"), [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Glaux",
      "Comment=Image and video analysis harness",
      `Exec="${shim}" open`,
      "Terminal=false",
      "Categories=Science;Graphics;",
      "",
    ].join("\n"));
  }
}

async function update() {
  if (!INSTALL_DIR) fail(t("源码目录请用 git pull 更新。", "Use git pull in a source checkout."));
  const latestUrl = process.env.GLAUX_UPDATE_URL?.trim() || `${PAGES_BASE}/latest.json`;
  const latest = await (await fetch(latestUrl, { signal: AbortSignal.timeout(30_000) })).json();
  if (compareVersions(latest.version, VERSION) <= 0) {
    info(t(`已是最新版本 ${VERSION}。`, `Already up to date (${VERSION}).`));
    return;
  }
  const asset = latest.assets?.["tar.gz"];
  if (!asset?.url || !asset?.sha256) fail(t("latest.json 缺少程序包信息。", "latest.json has no package entry."));
  step(t(`下载 ${latest.version}`, `downloading ${latest.version}`));

  const work = join(tmpdir(), `glaux-update-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const archive = join(work, "glaux.tar.gz");
    const base = process.env.GLAUX_DOWNLOAD_BASE?.trim();
    const url = base ? `${base.replace(/\/+$/u, "")}/${basename(new URL(asset.url).pathname)}` : asset.url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(t(`下载失败：HTTP ${response.status}`, `download failed: HTTP ${response.status}`));
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    if ((await sha256(archive)) !== asset.sha256) throw new Error(t("SHA256 校验失败。", "SHA256 mismatch."));

    const target = join(INSTALL_DIR, "versions", latest.version);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    // Windows 用系统自带的 bsdtar：PATH 上若是 Git 的 GNU tar，会把 C: 当成远程主机。
    const tar = IS_WIN ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    runOrFail(tar, ["-xzf", archive, "-C", target, "--strip-components=1"], {}, t("解压失败。", "extraction failed."));
    // 由新版本自己的启动器完成其余步骤，新版本的安装逻辑随包更新。
    const next = spawnSync(process.execPath, [join(target, "launcher", "glaux.mjs"), "install", "--restart"], { stdio: "inherit" });
    process.exitCode = next.status ?? 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 删除符号链接或目录联接本身（含悬空链接），不进入目标目录。 */
function removeLink(path) {
  try {
    (IS_WIN ? rmdirSync : unlinkSync)(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function switchCurrent(target) {
  const link = join(INSTALL_DIR, "current");
  const temp = `${link}.new`;
  removeLink(temp);
  symlinkSync(target, temp, IS_WIN ? "junction" : "dir");
  // Windows 的目录联接不能原子替换：只删联接本身（rmdir 不进入目标目录），再改名。
  if (IS_WIN) removeLink(link);
  renameSync(temp, link);
}

function pruneVersions(keep) {
  const dir = join(INSTALL_DIR, "versions");
  const versions = readdirSync(dir).filter((name) => /^\d+\.\d+\.\d+/u.test(name)).sort(compareVersions);
  for (const name of versions.slice(0, -2)) {
    if (name !== keep && name !== VERSION) rmSync(join(dir, name), { recursive: true, force: true });
  }
}

/** 只删除指向本安装目录的入口，避免卸载测试安装时误删正式安装的入口。 */
function removeShims() {
  if (IS_WIN) {
    powershell([
      `$shell = New-Object -ComObject WScript.Shell`,
      `foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {`,
      `  $path = Join-Path $dir 'Glaux.lnk'`,
      `  if ((Test-Path $path) -and $shell.CreateShortcut($path).WorkingDirectory -eq ${psQuote(INSTALL_DIR)}) { Remove-Item -Force $path }`,
      `}`,
      `$p = [Environment]::GetEnvironmentVariable('Path', 'User')`,
      `if ($p) { [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | Where-Object { $_ -and $_ -ne ${psQuote(join(INSTALL_DIR, "bin"))} }) -join ';'), 'User') }`,
    ].join("\n"));
    return;
  }
  const ours = (path) => {
    try {
      return readFileSync(path, "utf8").includes(INSTALL_DIR);
    } catch {
      return false;
    }
  };
  const link = join(homedir(), ".local", "bin", "glaux");
  try {
    if (readlinkSync(link).startsWith(INSTALL_DIR)) unlinkSync(link);
  } catch {
    // 不存在或不是链接。
  }
  const desktop = join(homedir(), ".local", "share", "applications", "glaux.desktop");
  if (ours(desktop)) rmSync(desktop, { force: true });
  const app = join(homedir(), "Applications", "Glaux.app");
  if (ours(join(app, "Contents", "MacOS", "Glaux"))) rmSync(app, { recursive: true, force: true });
}

async function uninstall(args) {
  if (!INSTALL_DIR) fail(t("源码目录无需卸载。", "Nothing to uninstall in a source checkout."));
  const purge = args.includes("--purge");
  if (purge && !args.includes("--yes")) {
    const answer = await prompt(t(`将删除全部数据 ${GLAUX_HOME}，输入 yes 确认：`, `This deletes all data in ${GLAUX_HOME}. Type yes to confirm: `));
    if (answer.trim().toLowerCase() !== "yes") fail(t("已取消。", "Cancelled."), 0);
  }
  await stop();
  removeShims();
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
  // Windows 无法删除正在运行的 node.exe 所在目录：交给启动器退出后执行的 PowerShell。
  // 路径经 -EncodedCommand（UTF-16）传递，.cmd 文件按系统代码页读取会把非 ASCII 路径读坏；
  // rmdir 删除 current 联接本身而不进入目标。
  // 经 Start-Process 另起进程，不随启动器所在的进程组一起结束。
  const encode = (script) => Buffer.from(script, "utf16le").toString("base64");
  const inner = encode(`Start-Sleep -Seconds 3; cmd /c rmdir /s /q "${INSTALL_DIR}"`);
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encode(
    `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${inner}'`,
  )], { stdio: "ignore", windowsHide: true });
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
  install     完成安装版的环境配置（安装脚本调用）
  uninstall   卸载程序，保留数据（--purge 同时删除数据）
  version     显示版本`, `Usage: glaux <command>

  start       start and open the browser (default)
  stop        stop
  status      show status
  open        open the browser (starts Glaux if needed)
  logs [n]    show logs
  doctor      check the environment
  update      update to the latest version
  install     finish setting up an installed copy (used by the installer)
  uninstall   remove the program, keep data (--purge also removes data)
  version     show the version`);

const [command = "start", ...rest] = process.argv.slice(2);
const commands = {
  start, stop, status, open, doctor, update,
  logs: () => logs(rest),
  install: () => install(rest),
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
