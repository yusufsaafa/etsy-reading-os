import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { developmentLoginAllowed, validDevelopmentPassword } from "./modules/identity/development-login";
import { database } from "./db/client";
import { users } from "./db/schema";
import { authenticateDevelopmentAccount, developmentAccountsAllowed } from "./modules/identity/accounts";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AccountSecurity, sessionIdentity } from "./modules/identity/security/service";

export function devLoginAllowed() {
  return developmentLoginAllowed();
}
const providers = [];
if ((process.env.NODE_ENV !== "production" || process.env.AUTH_LEGACY_GITHUB_ENABLED === "true") && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub({
  clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET,
  // Match GitHub's RFC 9207 authorization-response issuer; retain validation.
  issuer: "https://github.com/login/oauth",
}));
if (devLoginAllowed()) providers.push(Credentials({
  id: "development", name: "Development workspace", credentials: { password: { label: "Development password", type: "password" } },
  async authorize(credentials) {
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(credentials);
    if (!parsed.success || !validDevelopmentPassword(parsed.data.password)) return null;
    return { id: "dev:owner", name: "Development seller" };
  },
}));
providers.push(Credentials({
  id: "email-password", name: "Email and password", credentials: { email: { type: "email" }, password: { type: "password" } },
  async authorize(credentials) {
    try {
      if (developmentAccountsAllowed()) {
        const development = await authenticateDevelopmentAccount(database(), credentials);
        if (development) return development;
      }
      const account = await new AccountSecurity(database(), { async send() { throw new Error("EMAIL_UNAVAILABLE"); } }, process.env.AUTH_CODE_SECRET || "").login(credentials);
      if (account) return account;
      return null;
    } catch { return null; }
  },
}));
export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET, useSecureCookies: process.env.NODE_ENV === "production", providers, session: { strategy: "jwt", maxAge: 28800 }, pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ user, account }) {
      if (!account) return false;
      const id = account.provider === "development" && devLoginAllowed() ? "dev:owner" : account.provider === "email-password" && (user.id?.startsWith("account:") || (developmentAccountsAllowed() && user.id?.startsWith("email:"))) ? user.id : account.provider === "github" ? `github:${account.providerAccountId}` : null;
      if (!id) return false;
      if (account.provider === "github" && process.env.NODE_ENV === "production") {
        const [existing] = await database().select({ id: users.id }).from(users).where(eq(users.id,id));
        if (!existing) return false; // Legacy login only; no implicit identity creation/linking.
      }
      user.id = id;
      await database().insert(users).values({ id, name: user.name || "Seller" }).onConflictDoNothing();
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.sessionStartedAt = Date.now();
        token.sessionVersion = "sessionVersion" in user ? user.sessionVersion : await sessionIdentity(database(),user.id);
      }
      if (!token.sub) return null;
      const sessionStartedAt = typeof token.sessionStartedAt === "number" ? token.sessionStartedAt : typeof token.iat === "number" ? token.iat * 1000 : Date.now();
      token.sessionStartedAt = sessionStartedAt;
      if (Date.now() - sessionStartedAt >= 28800000 || sessionStartedAt > Date.now()) return null;
      const current = await sessionIdentity(database(),token.sub);
      if (current === null || current !== (token.sessionVersion ?? 0)) return null;
      return token;
    },
    async session({ session, token }) { if (session.user && token.sub) { session.user.id = token.sub; session.user.sessionVersion = Number(token.sessionVersion ?? 0); } return session; },
  },
  // Auth library errors may include provider data. Keep diagnostic output to safe codes only.
  logger: { error() { console.error("Application authentication failed"); }, warn() {}, debug() {} },
});
