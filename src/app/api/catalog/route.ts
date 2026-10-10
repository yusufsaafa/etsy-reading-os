import {auth} from "@/auth";
import {database} from "@/db/client";
import {findUserStore,authorizeStore} from "@/modules/identity/service";
import {readCatalog} from "@/modules/catalog/read";
import {syncCatalog} from "@/modules/catalog/sync";
import {CatalogError} from "@/modules/catalog/transport";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
async function ownedScope(owner:boolean){const user=(await auth())?.user;if(!user?.id)return null;const db=database(),store=await findUserStore(db,user.id);if(!store)throw new Error();return {db,scope:await authorizeStore(db,user.id,store.id,owner)};}
export async function GET(request:Request){
 let owned;try{owned=await ownedScope(false);}catch{return Response.json({error:"Access denied"},{status:403,headers});}if(!owned)return Response.json({error:"Sign in required"},{status:401,headers});
 try{const params=Object.fromEntries(new URL(request.url).searchParams);const query={...params,...(params.page?{page:Number(params.page)}:{}),...(params.pageSize?{pageSize:Number(params.pageSize)}:{})};return Response.json(await readCatalog(owned.db,owned.scope,query),{headers});}catch{return Response.json({error:"Catalog request unavailable"},{status:400,headers});}
}
export async function POST(request:Request){
 let owned;try{owned=await ownedScope(true);}catch{return Response.json({error:"Access denied"},{status:403,headers});}if(!owned)return Response.json({error:"Sign in required"},{status:401,headers});
 const origin=request.headers.get("origin"),host=request.headers.get("host")??new URL(request.url).host;let same=false;
 try{const u=new URL(origin??"");same=u.origin===origin&&u.host===host.toLowerCase()&&(u.protocol==="https:"||(process.env.NODE_ENV!=="production"&&u.protocol==="http:"));}catch{}
 if(!same)return Response.json({error:"Access denied"},{status:403,headers});
 let body:unknown;try{if(!request.headers.get("content-type")?.startsWith("application/json"))throw new Error();const reader=request.body?.getReader();if(!reader)throw new Error();let bytes=0;const chunks:Uint8Array[]=[];try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024)throw new Error();chunks.push(value);}}finally{await reader.cancel();}body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return Response.json({error:"Invalid synchronization request"},{status:400,headers});}
 try{return Response.json(await syncCatalog(owned.db,owned.scope,body),{headers});}catch(error){return Response.json({error:error instanceof CatalogError?error.code:"Synchronization unavailable"},{status:error instanceof CatalogError&&error.code==="BUSY"?409:400,headers});}
}
