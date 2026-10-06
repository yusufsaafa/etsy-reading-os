// Never retain exception messages, URLs, headers, request bodies or raw causes.
const allowed = ["ENOTFOUND","EAI_AGAIN","ECONNREFUSED","ECONNRESET","ETIMEDOUT","ENETUNREACH","EHOSTUNREACH","EACCES","EPERM","CERT_HAS_EXPIRED","DEPTH_ZERO_SELF_SIGNED_CERT","SELF_SIGNED_CERT_IN_CHAIN","UNABLE_TO_VERIFY_LEAF_SIGNATURE","UNABLE_TO_GET_ISSUER_CERT_LOCALLY","ERR_TLS_CERT_ALTNAME_INVALID","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"] as const;
export type TransportCause = typeof allowed[number] | "UNKNOWN";
export function safeTransportCause(error:unknown):TransportCause {
 const record=(v:unknown):Record<string,unknown>|undefined=>typeof v==="object"&&v!==null?v as Record<string,unknown>:undefined;
 const outer=record(error),cause=record(outer?.cause);
 for(const code of [cause?.code,outer?.code])if(typeof code==="string"&&allowed.includes(code as typeof allowed[number]))return code as TransportCause;
 return "UNKNOWN";
}
export function logTransportFailure(failure:{code:string;transportCause?:TransportCause}) {
 if(failure.transportCause&&["NETWORK","TIMEOUT"].includes(failure.code))try{console.warn(JSON.stringify({event:"ai_transport_failure",category:failure.code,transportCause:safeTransportCause({code:failure.transportCause})}));}catch{/* Diagnostic output must never prevent durable accounting settlement. */}
}
