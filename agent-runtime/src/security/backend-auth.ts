/**
 * backend 内部令牌（SDD 24 §7.2 规则 5）。
 *
 * 生产模式下 backend 只接受带 `X-Glaux-Internal` 的请求。runtime 访问 backend 的调用点分散在
 * 十余个工具里，这里在进程启动时包装全局 `fetch`：目标与 backend 同源的请求补上令牌，其余请求不变。
 */
export const INTERNAL_HEADER = "x-glaux-internal";

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function installBackendAuth(backendUrl: string, token: string, target: typeof globalThis = globalThis): void {
  const backendOrigin = originOf(backendUrl);
  if (!backendOrigin) throw new Error(`Invalid GLAUX_BACKEND_URL: ${backendUrl}`);
  const original = target.fetch.bind(target);

  target.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (originOf(url) !== backendOrigin) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(INTERNAL_HEADER, token);
    return original(input, { ...init, headers });
  };
}
