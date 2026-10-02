/**
 * SDD 16 §7.2：路径范围。解析相对 / 绝对路径，判定是否在工作目录之外（跟随符号链接）、是否隐藏。
 */
import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { PathScope } from "../plugins/types.js";

export interface ResolvedPath extends PathScope {
  /** 解析后的绝对路径（未跟随符号链接）。 */
  absolute: string;
  outside: boolean;
  hidden: boolean;
}

const UNICODE_SPACES = /[  -   　]/gu;

/** 与 pi 内置工具一致：统一 Unicode 空格，去掉开头的 `@`。 */
function normalize(raw: string): string {
  const value = raw.replace(UNICODE_SPACES, " ");
  return value.startsWith("@") ? value.slice(1) : value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 对最深的已存在祖先取真实路径，再接回尚不存在的部分。 */
async function realish(path: string): Promise<string> {
  const tail: string[] = [];
  let current = path;
  while (!(await exists(current))) {
    const parent = dirname(current);
    if (parent === current) break;
    tail.unshift(basename(current));
    current = parent;
  }
  const base = await realpath(current).catch(() => current);
  return tail.length ? join(base, ...tail) : base;
}

export async function resolvePathScope(cwd: string, raw: string): Promise<ResolvedPath> {
  const absolute = resolve(cwd, normalize(raw));
  const [realCwd, realTarget] = await Promise.all([realpath(cwd).catch(() => resolve(cwd)), realish(absolute)]);
  const rel = relative(realCwd, realTarget);
  const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const segments = outside || rel === "" ? [] : rel.split(sep);
  const hidden = segments.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
  return {
    absolute,
    outside,
    hidden,
    sensitive: outside || hidden,
    subject: outside ? realTarget : segments.join("/"),
  };
}
