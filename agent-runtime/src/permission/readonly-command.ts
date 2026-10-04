/**
 * SDD 16 §7.5 规则 6：`controlled` 下 `bash` 只放行只读命令。
 *
 * 判定解析整条命令，不做前缀匹配（前缀挡不住 `ls; rm -rf x`）。只读须同时满足：
 * 1. 结构：只由 `|` 连接的简单命令；出现命令拼接、重定向、变量展开、命令替换、花括号展开即否决。
 * 2. 命令名：每段都在白名单内。
 * 3. 选项：不含会写文件或执行程序的选项（如 `find -exec`、`sort -o`）。
 * 4. 路径：非选项参数都落在工作目录内且不是隐藏路径（与 `read` 的路径范围同一判定）。
 */
import { resolvePathScope } from "../workspace/path-scope.js";

/** 只读命令白名单：列目录、看文件、搜索与整理输出。 */
export const READONLY_COMMANDS = [
  "ls", "tree", "find", "du", "stat", "file", "pwd",
  "cat", "head", "tail", "wc",
  "grep", "rg", "sort", "uniq", "cut",
] as const;

const ALLOWED = new Set<string>(READONLY_COMMANDS);

/** 引号外出现即否决的字符：命令拼接、后台、重定向、子 shell、命令替换、变量与花括号展开、波浪号。 */
const FORBIDDEN_UNQUOTED = new Set([";", "&", "<", ">", "(", ")", "`", "$", "{", "}", "\n", "\r"]);

/** 各命令会写文件或执行程序的选项。长选项按前缀比对（覆盖 `--output=x`）。 */
const FORBIDDEN_LONG: Record<string, readonly string[]> = {
  find: ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fls", "-fprint", "-fprint0", "-fprintf"],
  sort: ["--output", "--compress-program"],
  rg: ["--pre"],
  file: ["--compile"],
  tree: ["--output"],
};
/** 短选项簇（如 `-uo`）里出现即否决的字母。 */
const FORBIDDEN_SHORT: Record<string, string> = { sort: "o", tree: "o", file: "C" };

interface Word {
  text: string;
}

/** 按 POSIX shell 的引号规则切词，按 `|` 分段；遇到否决字符返回理由。 */
function tokenize(command: string): { segments: Word[][] } | { reason: string } {
  const segments: Word[][] = [[]];
  let current = "";
  let started = false;
  const push = () => {
    if (started) segments[segments.length - 1]!.push({ text: current });
    current = "";
    started = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return { reason: "unterminated quote" };
      current += command.slice(i + 1, end);
      started = true;
      i = end;
      continue;
    }
    if (ch === "\"") {
      let j = i + 1;
      for (; j < command.length && command[j] !== "\""; j += 1) {
        // 双引号内仍会展开变量与命令替换；转义一律不收，规则保持简单
        if (command[j] === "$" || command[j] === "`" || command[j] === "\\") return { reason: `"${command[j]}" inside double quotes` };
      }
      if (j >= command.length) return { reason: "unterminated quote" };
      current += command.slice(i + 1, j);
      started = true;
      i = j;
      continue;
    }
    if (ch === "\\") {
      const next = command[i + 1];
      if (next === undefined || next === "\n") return { reason: "line continuation" };
      current += next;
      started = true;
      i += 1;
      continue;
    }
    if (ch === "|") {
      if (command[i + 1] === "|") return { reason: "\"||\"" };
      push();
      if (segments[segments.length - 1]!.length === 0) return { reason: "empty pipeline segment" };
      segments.push([]);
      continue;
    }
    if (FORBIDDEN_UNQUOTED.has(ch)) return { reason: `"${ch === "\n" || ch === "\r" ? "newline" : ch}"` };
    if (ch === "~" && !started) return { reason: "\"~\"" };
    if (/\s/u.test(ch)) {
      push();
      continue;
    }
    current += ch;
    started = true;
  }
  push();
  if (segments.some((segment) => segment.length === 0)) return { reason: "empty pipeline segment" };
  return { segments };
}

function optionViolation(name: string, args: readonly Word[]): string | undefined {
  const long = FORBIDDEN_LONG[name] ?? [];
  const short = FORBIDDEN_SHORT[name];
  for (const { text } of args) {
    if (long.some((option) => text === option || text.startsWith(`${option}=`))) return `${name} ${text.split("=")[0]}`;
    if (short && /^-[^-]/u.test(text) && text.slice(1).includes(short)) return `${name} -${short}`;
  }
  // uniq 的第二个操作数是输出文件
  if (name === "uniq" && args.filter((arg) => !arg.text.startsWith("-")).length > 1) return "uniq with an output file";
  return undefined;
}

/**
 * 返回 `undefined` 表示只读；否则返回不放行的理由（英文，回给模型）。
 * 非选项参数一律按路径判定：搜索词恰好像工作目录外或隐藏路径时也会否决，宁可误拒。
 */
export async function readOnlyViolation(command: string, cwd: string): Promise<string | undefined> {
  if (!command.trim()) return "empty command";
  const parsed = tokenize(command);
  if ("reason" in parsed) return `shell syntax ${parsed.reason} is not allowed`;
  for (const [head, ...args] of parsed.segments) {
    const name = head!.text;
    if (!ALLOWED.has(name)) return `"${name}" is not a read-only command`;
    const option = optionViolation(name, args);
    if (option) return `${option} can write files or run programs`;
    for (const arg of args) {
      if (arg.text.startsWith("-") || arg.text === "") continue;
      const scope = await resolvePathScope(cwd, arg.text);
      if (scope.outside) return `"${arg.text}" is outside the working directory`;
      if (scope.hidden) return `"${arg.text}" is a hidden path`;
    }
  }
  return undefined;
}
