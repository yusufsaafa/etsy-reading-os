import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { previousWorkContent } from "@/modules/seller-style/service";
import { AccessDenied } from "@/modules/identity/service";
import { Heading } from "@/components/ui";
import styles from "@/components/seller-style/profile.module.css";
export default async function PreviousWork({params}:{params:Promise<{id:string}>}){
  const scope=await currentScope(),{id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
  let source;try{source=await previousWorkContent(database(),scope,id);}catch(e){if(e instanceof AccessDenied)notFound();throw e;}
  return <div className={styles.content}><Link href="/settings/profile" className="button ghost">← Your profile & style</Link><Heading title={source.title} description="Private reference material. No analysis has been performed."/><section className={styles.section}><h2>Previous work</h2><div className={styles.reference} dir="auto">{source.text}</div></section></div>;
}
