import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, type AppErrorCode } from "@/lib/errors";

/**
 * SEC-006: route export/API tidak boleh membocorkan 500 untuk kesalahan
 * izin, validasi, atau dokumen yang tidak ditemukan. Mapper ini menjadi
 * satu pintu bagi route handler yang memakai AppError/Zod.
 */
const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  PERIOD_CLOSED: 409,
  INSUFFICIENT_STOCK: 409,
  INVALID_STATE: 409,
  ALREADY_POSTED: 409,
  IDEMPOTENT_REPLAY: 200,
  INTERNAL: 500,
};

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Parameter permintaan tidak valid.",
        code: "VALIDATION",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: STATUS_BY_CODE[error.code] ?? 500 },
    );
  }
  // Jangan bocorkan detail internal ke klien; log untuk operator.
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: "Terjadi kesalahan pada server.", code: "INTERNAL" },
    { status: 500 },
  );
}

export function withApiError<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}
