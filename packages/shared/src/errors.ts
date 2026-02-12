import type { ApiError } from "./types.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly payload: ApiError;

  constructor(statusCode: number, payload: ApiError) {
    super(payload.message);
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, { code: "BAD_REQUEST", message, details });
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError(401, { code: "UNAUTHORIZED", message });
}

export function forbidden(message = "Forbidden"): AppError {
  return new AppError(403, { code: "FORBIDDEN", message });
}

export function notFound(message = "Not Found"): AppError {
  return new AppError(404, { code: "NOT_FOUND", message });
}

export function conflict(message: string): AppError {
  return new AppError(409, { code: "CONFLICT", message });
}
