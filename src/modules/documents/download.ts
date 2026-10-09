import {z} from "zod";
import type {Database} from "../../db/client";
import type {Scope} from "../intake/contracts";
import type {ImmutableArtifactStorage} from "../../infrastructure/object-storage";
import {retrieveDocumentArtifact} from "./artifact-service";
/** IDs only; tenant scope comes from the authenticated server session, never query data. */
export async function downloadDocument(db:Database,scope:Scope,raw:unknown,storage:ImmutableArtifactStorage,disposition:"attachment"|"inline"="attachment"){
 const command=z.strictObject({readingId:z.uuid(),artifactId:z.uuid()}).parse(raw);
 const artifact=await retrieveDocumentArtifact(db,scope,command,storage);
 return new Response(Buffer.from(artifact.copyBytes()),{status:200,headers:{
  "Content-Type":"application/pdf","Content-Disposition":`${disposition}; filename="reading-${command.artifactId}.pdf"`,
  "Content-Length":String(artifact.metadata.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"sandbox; default-src 'none'","Referrer-Policy":"no-referrer",
 }});
}
