/** Server-only signal: emitted only after the submitted password is verified. */
export class UnverifiedLogin extends Error {
  constructor(readonly email: string) { super("Credential verification incomplete"); this.name = "UnverifiedLogin"; }
}
export function unverifiedLoginEmail(error: unknown): string | null {
  if (error instanceof UnverifiedLogin) return error.email;
  // Auth.js wraps provider failures in CallbackRouteError, preserving cause.err.
  if (error && typeof error === "object" && "cause" in error) {
    const cause = error.cause;
    if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof UnverifiedLogin) return cause.err.email;
  }
  return null;
}
