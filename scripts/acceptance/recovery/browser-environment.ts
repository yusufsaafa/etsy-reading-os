import {randomBytes} from "node:crypto";
export function browserEnvironment(inherited:NodeJS.ProcessEnv,envFileKeys:string[],databaseUrl:string):NodeJS.ProcessEnv {
 if(!inherited.DEV_LOGIN_PASSWORD||inherited.DEV_LOGIN_PASSWORD.length<16||inherited.DEV_LOGIN_PASSWORD.length>200)throw new Error("SYNTHETIC_LOGIN_PASSWORD_REQUIRED");
 // Blank every local env-file key first: Next must not fill absent keys with real credentials.
 const env:NodeJS.ProcessEnv={PATH:inherited.PATH,HOME:inherited.HOME,TMPDIR:inherited.TMPDIR,NODE_ENV:"development"};
 for(const key of envFileKeys)env[key]="";
 return {...env,NODE_ENV:"development",DATABASE_URL:databaseUrl,APP_URL:"http://127.0.0.1:3100",AUTH_URL:"http://127.0.0.1:3100",AUTH_TRUST_HOST:"true",AUTH_SECRET:randomBytes(32).toString("hex"),
  DEV_LOGIN_ENABLED:"true",DEV_LOGIN_PASSWORD:inherited.DEV_LOGIN_PASSWORD,DEV_ACCOUNT_AUTH_ENABLED:"false",AUTH_GITHUB_ID:"",AUTH_GITHUB_SECRET:"",
  ETSY_ADAPTER:"fixtures",ETSY_LIVE_OAUTH_ENABLED:"false",ETSY_AUTOMATIC_INTAKE_ENABLED:"false",ETSY_CLIENT_ID:"",ETSY_SHARED_SECRET:"",ETSY_WEBHOOK_SIGNING_SECRET:"",
  AI_PROVIDER:"fake",AI_GENERATION_MODEL:"deterministic-v1",GEMINI_API_KEY:"",AI_DAILY_BUDGET_NANOS:"0",AI_ATTEMPT_BUDGET_NANOS:"0",INTERNAL_TOOLS_ENABLED:"false",INTERNAL_OPERATOR_USER_IDS:"",NEXT_TELEMETRY_DISABLED:"1"};
}
