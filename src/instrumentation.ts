/**
 * FIX-ARS Tahap 1 (ARS4-03): Next.js calls `register()` once when a
 * server instance starts (dev and production). Importing the validated
 * env module here makes environment validation a real startup gate —
 * an invalid DATABASE_URL / DIRECT_URL / BETTER_AUTH_SECRET (or a
 * localhost BETTER_AUTH_URL in production) fails the boot with a clear
 * message instead of surfacing later as a confusing request error.
 * The dynamic import inside the NEXT_RUNTIME guard follows the
 * documented Next pattern so the edge runtime never evaluates the
 * Node-only env/DB module graph.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Strict re-validation at serving start (no build-phase relaxation):
  // a throw here aborts the boot with the offending variables named.
  const { parseEnv } = await import("@/lib/env");
  const { log } = await import("@/lib/log");
  const env = parseEnv(process.env);
  log.info("server.starting", { nodeEnv: env.nodeEnv });
  if (env.isProduction && env.localhostAuthUrlAllowed && env.betterAuthUrl) {
    // The exemption must never be silent in a production boot log.
    log.warn("server.auth_url_localhost_allowed", { nodeEnv: env.nodeEnv });
  }
}
