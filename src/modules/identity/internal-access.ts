/** Server-owned capability, independent of organization/Store roles.
 * Only IDs derived from the authenticated session may reach this boundary.
 */
export class InternalAccessDenied extends Error { constructor(){super("INTERNAL_ACCESS_DENIED");} }
export function internalOperatorAllowed(userId:string|undefined,env:Readonly<Record<string,string|undefined>>=process.env) {
 if(!["development","test","production"].includes(env.NODE_ENV??""))return false;
 if(!userId||env.INTERNAL_TOOLS_ENABLED!=="true")return false;
 const raw=env.INTERNAL_OPERATOR_USER_IDS;
 if(!raw||raw.length>4096)return false;
 const ids=raw.split(",").map(v=>v.trim());
 if(ids.length>20||ids.some(v=>!v||v.length>200||/\s/.test(v)))return false;
 // Production privileges must attach to a real supported OAuth identity, never dev credentials.
 if(env.NODE_ENV==="production"&&(!/^github:[0-9]+$/.test(userId)||ids.some(v=>!/^github:[0-9]+$/.test(v))))return false;
 return ids.includes(userId);
}
export function assertInternalOperator(userId:string|undefined) {
 if(!internalOperatorAllowed(userId))throw new InternalAccessDenied();
}
