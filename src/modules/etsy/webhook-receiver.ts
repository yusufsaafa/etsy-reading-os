import {createHash} from "node:crypto";
import {z} from "zod";
import {parseEtsyJson} from "./raw-normalizer";
import {etsyId} from "./source-contract";
import {MAX_WEBHOOK_BODY_BYTES, verifyEtsyWebhookSignature, webhookSecretConfigured} from "./webhook-digest";

const payloadSchema = z.object({
  event_type:z.enum(["order.paid","order.canceled","order.shipped","order.delivered"]),
  resource_url:z.string().max(256),
  shop_id:z.union([etsyId,z.number().int().positive().safe().transform(String)]),
}).strict();
export type VerifiedWebhook = Readonly<{
  eventId:string; eventType:z.infer<typeof payloadSchema>["event_type"];
  shopId:string; receiptId:string; bodyHash:string; signedAt:number;
}>;
const verifiedEvents = new WeakSet<object>();
export function assertVerifiedWebhook(event:VerifiedWebhook) {
  if (!verifiedEvents.has(event)) throw new Error("UNVERIFIED_WEBHOOK");
}
export class WebhookPayloadError extends Error {constructor(){super("INVALID_WEBHOOK_PAYLOAD");}}

/** Factory is the only source of runtime-verified evidence for persistence. */
export function authenticateEtsyWebhook(input:Parameters<typeof verifyEtsyWebhookSignature>[0]):VerifiedWebhook|undefined {
  if (!verifyEtsyWebhookSignature(input)) return undefined;
  try {
    const payload=payloadSchema.parse(parseEtsyJson(new TextDecoder("utf-8",{fatal:true}).decode(input.rawBody!)));
    // Literal allowlist: no userinfo, ports, redirects, queries, fragments or escapes.
    const match=/^https:\/\/api\.etsy\.com\/v3\/application\/shops\/([1-9][0-9]{0,19})\/receipts\/([1-9][0-9]{0,19})$/.exec(payload.resource_url);
    if (!match || match[1]!==payload.shop_id) throw new WebhookPayloadError();
    const event=Object.freeze({eventId:input.messageId!,eventType:payload.event_type,shopId:match[1],receiptId:match[2],
      bodyHash:createHash("sha256").update(input.rawBody!).digest("hex"),signedAt:Number(input.timestamp)});
    verifiedEvents.add(event);
    return event;
  } catch {throw new WebhookPayloadError();}
}

/** No database construction or external I/O before signature/payload verification. */
export async function handleEtsyWebhook(request:Request,ports:{
  secret?:string; nowSeconds?:number; accept:(event:VerifiedWebhook)=>Promise<unknown>;
}):Promise<Response> {
  if (request.method!=="POST") return new Response(null,{status:405,headers:{Allow:"POST"}});
  if (!webhookSecretConfigured(ports.secret)) return new Response(null,{status:503});
  const length=request.headers.get("content-length");
  if (length!==null && (!/^\d{1,10}$/.test(length) || Number(length)>MAX_WEBHOOK_BODY_BYTES)) return new Response(null,{status:413});
  const reader=request.body?.getReader();
  if (!reader) return new Response(null,{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while (true) {
      const chunk=await reader.read();if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>MAX_WEBHOOK_BODY_BYTES){await reader.cancel();return new Response(null,{status:413});}
      chunks.push(chunk.value);
    }
  } catch {return new Response(null,{status:400});}
  finally {reader.releaseLock();}
  const proof={messageId:request.headers.get("webhook-id")??undefined,
    timestamp:request.headers.get("webhook-timestamp")??undefined,signature:request.headers.get("webhook-signature")??undefined,
    rawBody:Buffer.concat(chunks),secret:ports.secret,nowSeconds:ports.nowSeconds};
  // Portal examples contain synthetic resource identities. Authenticate exact bytes
  // first; tests acknowledge transport only and never create durable intake evidence.
  if (!verifyEtsyWebhookSignature(proof)) return new Response(null,{status:401});
  if (request.headers.get("webhook-test")==="true") return new Response(null,{status:204});
  let event:VerifiedWebhook|undefined;
  try {
    event=authenticateEtsyWebhook(proof);
  } catch {return new Response(null,{status:400});}
  if(!event)return new Response(null,{status:401});
  try {await ports.accept(event);} catch {return new Response(null,{status:503});}
  // Conventional durable acknowledgement. Exact Etsy interoperability is unverified.
  return new Response(null,{status:204});
}
