import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import {
  claimIdempotencyKey,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";

const SESSION_CLOSE_SCOPE = "pos.session_close";
const SESSION_CLOSE_TOKEN_TTL_MS = 15 * 60 * 1000;

type SessionCloseTokenPayload = {
  type: "pos.session.close";
  sessionId: string;
  userId: string;
  counted: string;
  expected: string;
  expiresAt: number;
};

export async function issueSessionCloseToken(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    counted: string | number;
    expected: string | number;
  },
): Promise<{ token: string; counted: string; expected: string; difference: string }> {
  const counted = d(input.counted);
  if (counted.lt(0)) {
    throw new AppError("VALIDATION", "Uang dihitung tidak boleh negatif.");
  }
  const token = crypto.randomUUID();
  await claimIdempotencyKey(tx, {
    companyId: input.companyId,
    key: token,
    scope: SESSION_CLOSE_SCOPE,
  });
  const payload: SessionCloseTokenPayload = {
    type: "pos.session.close",
    sessionId: input.sessionId,
    userId: input.userId,
    counted: toDb(counted),
    expected: toDb(d(input.expected)),
    expiresAt: Date.now() + SESSION_CLOSE_TOKEN_TTL_MS,
  };
  await writeIdempotencyResultRef(tx, {
    companyId: input.companyId,
    key: token,
    scope: SESSION_CLOSE_SCOPE,
    resultRef: JSON.stringify(payload),
  });
  return {
    token,
    counted: payload.counted,
    expected: payload.expected,
    difference: toDb(counted.minus(d(input.expected))),
  };
}

export async function verifySessionCloseToken(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    counted: string | number;
    token: string;
  },
): Promise<{ expected: string }> {
  const stored = await readIdempotencyResultRef(tx, {
    companyId: input.companyId,
    key: input.token,
    scope: SESSION_CLOSE_SCOPE,
  });
  let payload: SessionCloseTokenPayload | null = null;
  try {
    payload = stored ? (JSON.parse(stored) as SessionCloseTokenPayload) : null;
  } catch {
    payload = null;
  }
  if (
    !payload ||
    payload.type !== "pos.session.close" ||
    payload.sessionId !== input.sessionId ||
    payload.userId !== input.userId ||
    payload.expiresAt < Date.now() ||
    payload.counted !== toDb(d(input.counted))
  ) {
    throw new AppError(
      "CONFLICT",
      "Hitungan sesi sudah kedaluwarsa atau tidak cocok. Kunci hitungan ulang sebelum menutup sesi.",
    );
  }
  return { expected: payload.expected };
}
