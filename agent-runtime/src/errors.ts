import { randomUUID } from "node:crypto";

import type { SafeErrorBody } from "./contracts.js";

export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeError";
  }
}

export function safeError(error: unknown, traceId: string = randomUUID()): SafeErrorBody {
  if (error instanceof RuntimeError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        trace_id: traceId,
      },
    };
  }
  return {
    error: {
      code: "internal_error",
      message: "Agent Runtime encountered an unexpected error.",
      trace_id: traceId,
    },
  };
}
