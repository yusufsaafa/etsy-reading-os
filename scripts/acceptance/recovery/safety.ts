export const TARGET = "etsy_reading_os_recovery_acceptance";
export const ROLE = "yusufsafakilic";
const PROTECTED = new Set(["etsy_reading_os", "etsy_reading_os_webhook_test"]);
export function requireRuntime(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 22 || Number(match[1]) === 22 && Number(match[2]) < 12)
    throw new Error("NODE_22_12_OR_NEWER_REQUIRED");
}
export function requireConfirmation(env: Record<string, string | undefined>) {
  if (env.RECOVERY_ACCEPTANCE_CONFIRM !== TARGET) throw new Error("EXPLICIT_ACCEPTANCE_DATABASE_CREATION_CONFIRMATION_REQUIRED");
}
export function requireTarget(database: string) {
  if (PROTECTED.has(database) || !["postgres", TARGET].includes(database)) throw new Error("DATABASE_TARGET_FORBIDDEN");
}
export class IdentityMismatch extends Error {
  constructor(readonly fields: string[]) { super("DATABASE_IDENTITY_MISMATCH"); }
}
export function requireIdentity(row: Record<string, unknown> | undefined, expected: string) {
  requireTarget(expected);
  const fields = !row ? ["row"] : [
    ...(row.database !== expected ? ["database"] : []),
    ...(row.role !== ROLE ? ["role"] : []),
    ...(row.address !== "127.0.0.1" ? ["address"] : []),
    ...(row.port !== 5432 ? ["port"] : []),
    ...(typeof row.oid !== "number" ? ["oid"] : []),
  ];
  if (fields.length) throw new IdentityMismatch(fields);
}
export function requireAbsent(rows: readonly unknown[]) {
  if (rows.length) throw new Error("ACCEPTANCE_DATABASE_ALREADY_EXISTS_REFUSING_REUSE");
}
export function connectionOptions(database: string, password: string) {
  requireTarget(database);
  return {host: "127.0.0.1", port: 5432, username: ROLE, database, password,
    ssl: false as const, max: 1, idle_timeout: 0, connect_timeout: 5, max_lifetime: null,
    debug: false, onnotice: () => {},
    connection: {application_name: "reading-os-recovery-acceptance", statement_timeout: 20000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000}};
}
