export type PublicErrorCode =
  | "authentication_required"
  | "invalid_session"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "data_access_error"
  | "configuration_error"
  | "internal_error";

export class AppError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PublicErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("internal_error", "Внутренняя ошибка сервера.", 500);
}

export function publicErrorPayload(error: unknown): {
  error: {
    code: PublicErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
} {
  const safe = toAppError(error);
  return {
    error: {
      code: safe.code,
      message: safe.message,
      ...(safe.details ? { details: safe.details } : {}),
    },
  };
}
