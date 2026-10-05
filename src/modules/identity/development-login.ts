import { createHash, timingSafeEqual } from "node:crypto";
export function developmentLoginAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.DEV_LOGIN_ENABLED === "true" && env.ETSY_ADAPTER === "fixtures";
}
export function validDevelopmentPassword(input: string, env: NodeJS.ProcessEnv = process.env) {
  const expected = env.DEV_LOGIN_PASSWORD;
  if (!developmentLoginAllowed(env) || !expected || expected.length < 16 || input.length > 200) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(input), hash(expected));
}
