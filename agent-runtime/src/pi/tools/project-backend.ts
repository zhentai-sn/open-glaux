/**
 * 项目浏览工具与越界守卫共用的 backend 访问助手（SDD 13 §9.1）。
 *
 * 目标固定为本机 backend（`GLAUX_BACKEND_URL`），不做 SSRF 守卫；错误一律转成带 HTTP 状态与
 * 错误码的 `Error`，由 Pi 在工具执行层接住并以工具错误返回模型，不中断回合（§7.3 规则 6）。
 */

/** §9.1 列出的业务错误码；backend 的错误体形状未钉死时，用来从文本里识别。 */
const KNOWN_CODES = ["outside_project", "unsupported_format", "corrupt"] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 解析 backend 错误体。兼容三种写法：`{detail: {code, message}}`（`/atlas` 的写法）、
 * `{detail: "…"}`（FastAPI 缺省）与顶层 `{code, message}`。
 */
export async function readBackendError(response: Response): Promise<{ code?: string; message?: string }> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown> | null;
    const detail = body?.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      code = text((detail as Record<string, unknown>).code);
      message = text((detail as Record<string, unknown>).message);
    } else {
      message = text(detail);
    }
    code ??= text(body?.code);
    message ??= text(body?.message);
  } catch {
    /* 非 JSON 错误体 */
  }
  if (!code && message) code = KNOWN_CODES.find((known) => message!.includes(known));
  return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/** 把非 2xx 响应转成工具错误；`code` 写进文本，模型据此决定换路径还是告知用户。 */
export async function backendFailure(response: Response, action: string): Promise<Error> {
  const { code, message } = await readBackendError(response);
  const head = `${action} failed (HTTP ${response.status}${code ? `, code ${code}` : ""})`;
  return new Error(message ? `${head}: ${message}` : `${head}.`);
}

/** 网络层失败（backend 不可达、超时）：与 HTTP 失败同样以工具错误返回。 */
export function unreachable(action: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`${action} failed: Glaux backend is unreachable (${reason}).`);
}

export function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
