/** Configuration validation only: no database/storage connections or object operations. */
export async function register(){
 if(process.env.NEXT_RUNTIME==="nodejs"&&process.env.DOCUMENT_STORAGE_DRIVER==="s3-compatible"){
  const {s3Configuration}=await import("./infrastructure/s3-artifact-storage");
  s3Configuration(process.env);
 }
}
