/**
 * 符号链接能力探测。
 *
 * Windows 只在开启「开发者模式」或以管理员身份运行时允许创建符号链接（否则 EPERM /
 * WinError 1314）。用到软链接的用例应当据此跳过，而不是让整份本地测试变红；
 * CI 的 Windows runner 有权限，照常执行。
 */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: Promise<boolean> | undefined;

async function probe(): Promise<boolean> {
  const root = await mkdtemp(join(tmpdir(), "glaux-symlink-probe-"));
  try {
    await writeFile(join(root, "target.txt"), "x");
    await symlink(join(root, "target.txt"), join(root, "link.txt"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** 当前环境能否创建符号链接；同一进程内只探测一次。 */
export function canCreateSymlinks(): Promise<boolean> {
  cached ??= probe();
  return cached;
}
