#!/usr/bin/env node
/**
 * 构建与平台无关的 Glaux 程序包（SDD 24 §7.5）。
 *
 *   node scripts/release/build-package.mjs [--skip-build] [--out dist/release] [--base-url <Release 下载地址前缀>]
 *
 * 产物：glaux-<版本>.tar.gz、glaux-<版本>.zip、SHA256SUMS；给出 --base-url 时另写 latest.json。
 * 前提：已安装 frontend 与 agent-runtime 的依赖；需要 uv、python3（写 zip）与 tar。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const VERSION = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
const OUT = resolve(ROOT, option("--out", "dist/release"));
const NAME = `glaux-${VERSION}`;
const STAGE = join(OUT, NAME);

const run = (command, commandArgs, cwd = ROOT) =>
  execFileSync(command, commandArgs, { cwd, stdio: "inherit", env: { ...process.env, CI: "1" } });

if (!flag("--skip-build")) {
  run("npm", ["run", "build"], join(ROOT, "frontend"));
  run("npm", ["run", "build"], join(ROOT, "agent-runtime"));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const SKIP = new Set(["__pycache__", ".pytest_cache", ".venv", "node_modules", ".DS_Store"]);
function copy(from, to = from) {
  const source = join(ROOT, from);
  if (!existsSync(source)) throw new Error(`missing ${from}`);
  cpSync(source, join(STAGE, to), {
    recursive: true,
    filter: (path) => !SKIP.has(path.split(/[\\/]/u).at(-1)) && !path.endsWith(".pyc"),
  });
}

for (const file of ["VERSION", "LICENSE", "NOTICE", "README.md", "README.zh-CN.md"]) copy(file);
copy("launcher/glaux.mjs");
copy("frontend/dist");
for (const path of ["dist", "package.json", "package-lock.json", "skills", "agents"]) copy(`agent-runtime/${path}`);
for (const path of ["app", "pyproject.toml", "uv.lock"]) copy(`backend/${path}`);
for (const path of ["glaux_core", "pyproject.toml"]) copy(`science-core/${path}`);
// 带哈希的依赖清单：安装时用 uv pip install --require-hashes，可换 PyPI 镜像而不失校验。
run("uv", [
  "export", "--frozen", "--no-dev", "--extra", "video", "--no-emit-project", "--no-header", "--format", "requirements-txt",
  "-o", join(STAGE, "backend", "requirements.lock.txt"),
], join(ROOT, "backend"));
mkdirSync(join(STAGE, "data", "natural"), { recursive: true });
for (const file of readdirSync(join(ROOT, "data", "natural"))) copy(`data/natural/${file}`);

// 运行期依赖不含原生扩展（SQLite 用 node:sqlite），一份 node_modules 通用于三平台；
// --no-bin-links 避免符号链接，Windows 解压不需要创建链接的权限。
run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-bin-links", "--no-audit", "--no-fund"], join(STAGE, "agent-runtime"));
// @fastify/send 的测试夹具不是运行依赖；其中 Unicode 目录会让部分 Windows tar 报空路径。
rmSync(join(STAGE, "agent-runtime", "node_modules", "@fastify", "send", "test"), { recursive: true, force: true });
const natives = [];
(function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name.endsWith(".node")) natives.push(relative(STAGE, path));
  }
})(join(STAGE, "agent-runtime", "node_modules"));
if (natives.length) throw new Error(`native addons are not portable:\n${natives.join("\n")}`);

const tarball = join(OUT, `${NAME}.tar.gz`);
const zip = join(OUT, `${NAME}.zip`);
run("tar", ["-czf", tarball, "-C", OUT, NAME]);
run("python3", ["-c", `
import os, sys, zipfile
out, base, name = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(os.path.join(base, name)):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, base))
`, zip, OUT, NAME]);
rmSync(STAGE, { recursive: true, force: true });

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sums = { "tar.gz": sha(tarball), zip: sha(zip) };
writeFileSync(join(OUT, "SHA256SUMS"), `${sums["tar.gz"]}  ${NAME}.tar.gz\n${sums.zip}  ${NAME}.zip\n`);

const baseUrl = option("--base-url");
if (baseUrl) {
  const base = baseUrl.replace(/\/+$/u, "");
  const latest = {
    version: VERSION,
    tag: `v${VERSION}`,
    published_at: new Date().toISOString().slice(0, 10),
    assets: {
      "tar.gz": { url: `${base}/${NAME}.tar.gz`, sha256: sums["tar.gz"] },
      zip: { url: `${base}/${NAME}.zip`, sha256: sums.zip },
    },
  };
  writeFileSync(join(OUT, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
}

for (const file of readdirSync(OUT)) {
  console.log(`${file}\t${(statSync(join(OUT, file)).size / 2 ** 20).toFixed(1)} MiB`);
}
