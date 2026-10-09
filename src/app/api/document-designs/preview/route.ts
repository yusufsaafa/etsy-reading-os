import { auth } from "@/auth";
import { database } from "@/db/client";
import { findUserStore,authorizeStore } from "@/modules/identity/service";
import { documentDesignSchema } from "@/modules/documents/contracts";
import { renderStudioPreview } from "@/modules/documents/studio-preview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
let rendering=0;
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request) {
 const user=(await auth())?.user;if(!user?.id)return new Response("Sign in to preview a design.",{status:401,headers});
 // Next's request URL can use the internal listen host behind a proxy. Compare the
 // browser origin with the actual HTTP Host; never trust an arbitrary forwarded host.
 const rawOrigin=request.headers.get("origin"),host=request.headers.get("host")??new URL(request.url).host;
 let sameOrigin=false;
 try{const origin=new URL(rawOrigin??"");sameOrigin=origin.origin===rawOrigin&&origin.host===host.toLowerCase()&&(origin.protocol==="https:"||(process.env.NODE_ENV!=="production"&&origin.protocol==="http:"));}catch{}
 if(!sameOrigin)return new Response("Preview unavailable.",{status:403,headers});
 try{const db=database(),store=await findUserStore(db,user.id);if(!store)throw new Error("DENIED");await authorizeStore(db,user.id,store.id,true);}catch{return new Response("Preview unavailable.",{status:403,headers});}
 if(rendering>=2)return new Response("Preview is busy. Try again.",{status:429,headers:{...headers,"Retry-After":"2"}});
 let configuration;
 try{
  if(!request.headers.get("content-type")?.startsWith("application/json"))throw new Error("INVALID");
  const reader=request.body?.getReader();if(!reader)throw new Error("INVALID");let bytes=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192)throw new Error("LARGE");chunks.push(value);}}finally{await reader.cancel();}
  configuration=documentDesignSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
 }catch{return new Response("Review the design settings before previewing.",{status:400,headers});}
 // Recheck after the asynchronous body read; simultaneous requests must not race admission.
 if(rendering>=2)return new Response("Preview is busy. Try again.",{status:429,headers:{...headers,"Retry-After":"2"}});
 rendering++;
 try{const {pdf}=await renderStudioPreview(configuration);return new Response(Buffer.from(pdf.copyBytes()),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":'inline; filename="design-preview.pdf"',"X-Preview-Pages":String(pdf.metadata.pageCount)}});}
 catch{return new Response("This design could not be previewed. Check its text and supported fonts.",{status:422,headers});}
 finally{rendering--;}
}
