import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {browserEnvironment} from "../scripts/acceptance/recovery/browser-environment";
it("requires a seller-supplied synthetic login password",()=>{expect(()=>browserEnvironment({NODE_ENV:"development"},[],"isolated")).toThrow("PASSWORD_REQUIRED");});
it("isolates app configuration from inherited and local-file live credentials",()=>{
 const env=browserEnvironment({NODE_ENV:"development",DEV_LOGIN_PASSWORD:"synthetic-password-for-tests",PATH:"/runtime",DATABASE_URL:"protected",GEMINI_API_KEY:"real",AUTH_GITHUB_SECRET:"real",ETSY_ADAPTER:"etsy"},["GEMINI_API_KEY","AUTH_GITHUB_SECRET","ETSY_SHARED_SECRET","UNRELATED_FILE_SECRET","AI_PROVIDER"],"isolated");
 expect(env.DATABASE_URL).toBe("isolated");expect(env.ETSY_ADAPTER).toBe("fixtures");expect(env.AI_PROVIDER).toBe("fake");expect(env.GEMINI_API_KEY).toBe("");expect(env.AUTH_GITHUB_SECRET).toBe("");expect(env.ETSY_SHARED_SECRET).toBe("");expect(env.UNRELATED_FILE_SECRET).toBe("");expect(env.ETSY_LIVE_OAUTH_ENABLED).toBe("false");expect(env.ETSY_AUTOMATIC_INTAKE_ENABLED).toBe("false");expect(env.INTERNAL_TOOLS_ENABLED).toBe("false");expect(env.AUTH_SECRET).toHaveLength(64);expect(env.DEV_LOGIN_PASSWORD).toBe("synthetic-password-for-tests");
});
it("host entry point verifies reuse rather than creating databases or rerunning native acceptance",()=>{
 const source=readFileSync("scripts/acceptance/recovery/browser-host.ts","utf8");expect(source).not.toMatch(/CREATE DATABASE|DROP DATABASE|from "\.\/native"|await migrate\(/);expect(source).toContain("requireIdentity(identity[0],TARGET)");expect(source).toContain("EXPLICIT_BROWSER_FIXTURE_CONFIRMATION_REQUIRED");expect(source).toContain("BROWSER_FIXTURE_ALREADY_RECOVERED_REFUSING_RESET");expect(source).toContain('"127.0.0.1","--port","3100"');
});
