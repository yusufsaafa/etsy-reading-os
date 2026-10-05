import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { developmentLoginAllowed, validDevelopmentPassword } from "./modules/identity/development-login";
import { database } from "./db/client";
import { users } from "./db/schema";
import { authenticateDevelopmentAccount, developmentAccountsAllowed } from "./modules/identity/accounts";
import { z } from "zod";

export function devLoginAllowed() {
  return developmentLoginAllowed();
}
const providers = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET }));
if (devLoginAllowed()) providers.push(Credentials({
  id: "development", name: "Development workspace", credentials: { password: { label: "Development password", type: "password" } },
  async authorize(credentials) {
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(credentials);
    if (!parsed.success || !validDevelopmentPassword(parsed.data.password)) return null;
    return { id: "dev:owner", name: "Development seller" };
  },
}));
if (developmentAccountsAllowed()) providers.push(Credentials({
  id: "email-password", name: "Development account", credentials: { email: { type: "email" }, password: { type: "password" } },
  async authorize(credentials) { return authenticateDevelopmentAccount(database(), credentials); },
}));
export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET, providers, session: { strategy: "jwt", maxAge: 28800 }, pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ user, account }) {
      if (!account) return false;
      const id = account.provider === "development" && devLoginAllowed() ? "dev:owner" : account.provider === "email-password" && developmentAccountsAllowed() && user.id?.startsWith("email:") ? user.id : account.provider === "github" ? `github:${account.providerAccountId}` : null;
      if (!id) return false;
      user.id = id;
      await database().insert(users).values({ id, name: user.name || "Seller" }).onConflictDoNothing();
      return true;
    },
    async jwt({ token, user }) { if (user?.id) token.sub = user.id; return token; },
    async session({ session, token }) { if (session.user && token.sub) session.user.id = token.sub; return session; },
  },
  // Auth library errors may include provider data. Keep diagnostic output to safe codes only.
  logger: { error() { console.error("Application authentication failed"); }, warn() {}, debug() {} },
});
