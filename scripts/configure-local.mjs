import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env.local")) throw new Error(".env.local already exists; keep its current keys and edit it manually.");
const value = (n=32) => randomBytes(n).toString("base64url");
writeFileSync(".env.local", `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/etsy_reading_os
AUTH_SECRET=${value()}
AUTH_URL=http://localhost:3000
APP_URL=http://localhost:3000
DEV_LOGIN_ENABLED=true
DEV_LOGIN_PASSWORD=${value()}
ETSY_ADAPTER=fixtures
SECRET_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}
SECRET_KEY_ID=local-v1
ETSY_LIVE_OAUTH_ENABLED=false
`, { mode: 0o600, flag:"wx" });
console.log("Created private .env.local with development credentials. Read its DEV_LOGIN_PASSWORD locally to sign in; do not share or commit it.");
