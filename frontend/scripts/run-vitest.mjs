import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const tempDir = resolve("node_modules/.glaux-tmp");
mkdirSync(tempDir, { recursive: true });

const args = process.argv.slice(2);
if (!args.includes("--exclude")) {
  args.push("--exclude", "dist/**");
}

const child = spawn(
  process.execPath,
  [resolve("node_modules/vitest/vitest.mjs"), ...args],
  {
    env: {
      ...process.env,
      TEMP: tempDir,
      TMP: tempDir,
      TMPDIR: tempDir,
    },
    stdio: "inherit",
  },
);

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
