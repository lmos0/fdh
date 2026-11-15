import type { ErrorCode } from "../../shared/protocol";

export class RuleError extends Error {
  requestId?: string;
  constructor(public readonly code: ErrorCode, message: string = code) { super(message); }
}

export function requireRule(condition: unknown, code: ErrorCode): asserts condition {
  if (!condition) throw new RuleError(code);
}
