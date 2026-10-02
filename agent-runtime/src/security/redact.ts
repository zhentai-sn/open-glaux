const SENSITIVE_KEY = /credential|api[_-]?key|authorization|cookie|bearer|token/i;
const BEARER_TEXT = /(bearer\s+)[^\s,;]+/gi;
const KEY_VALUE_TEXT =
  /((?:credential|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi;
const MEDIA_DATA_URI = /data:[^,\s]*;base64,[A-Za-z0-9+/=]+/gi;

export const REDACTED = "[REDACTED]";

export function redactText(value: string): string {
  return value
    .replace(MEDIA_DATA_URI, "data:;base64,[REDACTED]")
    .replace(BEARER_TEXT, `$1${REDACTED}`)
    .replace(KEY_VALUE_TEXT, `$1${REDACTED}`);
}

/**
 * 只对结构中的字符串逐个执行 `redactText`，不按键名整体替换。
 * 不能对 `JSON.stringify` 的结果整体执行：`BEARER_TEXT` 会吞掉字符串的结束引号，产出非法 JSON。
 */
export function redactStrings<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactStrings(item)) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item)])) as T;
}

export function redact<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, seen);
  }
  return result;
}
