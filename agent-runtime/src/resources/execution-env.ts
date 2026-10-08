import { basename } from "node:path";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

// Pi 的资源扫描器按 '/' 计算相对路径；Node 文件 IO 在 Windows 同时接受两种分隔符。
// 只规范化扫描结果，保留 POSIX 上合法的反斜杠文件名；实际工具执行环境不受影响。
const resourcePath = (path: string) => process.platform === "win32" ? path.replace(/\\/gu, "/") : path;

export class ResourceExecutionEnv extends NodeExecutionEnv {
  override async fileInfo(path: string) {
    const result = await super.fileInfo(path);
    return result.ok ? { ...result, value: { ...result.value, name: basename(result.value.path), path: resourcePath(result.value.path) } } : result;
  }

  override async listDir(path: string, abortSignal?: AbortSignal) {
    const result = await super.listDir(path, abortSignal);
    return result.ok ? { ...result, value: result.value.map(file => ({ ...file, name: basename(file.path), path: resourcePath(file.path) })) } : result;
  }
}
