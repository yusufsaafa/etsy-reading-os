import {auth} from "@/auth";
import {database} from "@/db/client";
import {authorizeStore,findUserStore} from "@/modules/identity/service";
import {downloadDocument} from "@/modules/documents/download";
import {configuredDocumentPorts} from "@/infrastructure/document-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const unavailable=(status:number)=>new Response("Document unavailable",{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request,context:{params:Promise<{readingId:string;artifactId:string}>}){
 const session=await auth();if(!session?.user?.id)return unavailable(401);
 try{
  const db=database(),store=await findUserStore(db,session.user.id);if(!store)return unavailable(404);
  const scope=await authorizeStore(db,session.user.id,store.id),params=await context.params;
  // Resolve/authorize artifact before storage configuration is consulted.
  const {getDocumentArtifact}=await import("@/modules/documents/artifact-service");
  await getDocumentArtifact(db,scope,params.readingId,params.artifactId);
  const ports=configuredDocumentPorts();if(!ports)return unavailable(503);
  const views=new URL(request.url).searchParams.getAll("view");
  return views.length===1&&views[0]==="inline"?await downloadDocument(db,scope,params,ports.artifacts,"inline"):await downloadDocument(db,scope,params,ports.artifacts);
 }catch{return unavailable(404);}
}
