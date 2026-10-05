import Link from "next/link";
import { randomUUID } from "node:crypto";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { sellerStyleData } from "@/modules/seller-style/service";
import { Heading, Badge, Button } from "@/components/ui";
import { ProfileForm, StyleForm, PasteForm, DeleteSource } from "@/components/seller-style/forms";
import { beginStyle } from "@/components/seller-style/actions";
import styles from "@/components/seller-style/profile.module.css";
const labels:Record<string,string>={WARM:"Warm & supportive",DIRECT:"Direct",REASSURING:"Reassuring",NEUTRAL:"Neutral",CUSTOM:"Custom",CONCISE:"Concise",BALANCED:"Balanced",DETAILED:"Detailed",CONVERSATIONAL:"Conversational",STRUCTURED:"Structured",REFLECTIVE:"Reflective"};
export default async function ProfileStyle(){
  const data=await sellerStyleData(database(),await currentScope());
  return <div className={styles.content}><Link href="/settings" className="button ghost">← Settings</Link><Heading title="Your profile & style" description="Keep your work consistent with the person behind your store."/>
    <section className={styles.section}><header><h2>Your profile</h2><p className="small muted">Your creator name can be different from your Etsy shop name.</p></header><ProfileForm displayName={data.seller?.displayName??""} shortBio={data.seller?.shortBio??""}/></section>
    <section className={styles.section}><header><h2>Your style</h2><p className="small muted">Your style helps Reading OS prepare work that sounds consistent with you. Content creation is not available yet.</p></header><div>{data.active?<div className={styles.current}><Badge tone="good">Current style</Badge><p className="small muted">{[data.active.configuration.tone,data.active.configuration.detail,data.active.configuration.approach].map(v=>labels[v!]).join(" · ")}</p></div>:<p className="small muted">Choose how your work should sound, then apply your style.</p>}
    {data.draft?<><div className={styles.current}><Badge>Draft changes</Badge>{data.active&&<span className="small muted">Your current style stays unchanged until you apply these edits.</span>}</div><StyleForm key={data.draft.id} versionId={data.draft.id} revision={data.draft.revision} initial={data.draft.configuration}/></>:<>{data.active&&<dl className={styles.summary}><dt>Preferred expressions</dt><dd>{data.active.configuration.preferredExpressions.join("\n")||"None added"}</dd><dt>Avoid</dt><dd>{data.active.configuration.avoidExpressions.join("\n")||"None added"}</dd><dt>Additional guidance</dt><dd>{data.active.configuration.instructions||"None added"}</dd></dl>}<form action={beginStyle}><Button className={data.active?"secondary":""}>{data.active?"Edit style":"Set up your style"}</Button></form></>}
    </div></section>
    <section className={styles.section}><header><h2>Previous work</h2><p className="small muted">Add examples of work that sounds like you. This is optional.</p></header><div><p className="small muted">Your library stores reference material for future orders. Nothing is analyzed or generated when you add it.</p><PasteForm commandKey={randomUUID()}/><p className="small muted">File uploads are not available yet. Paste text from your own documents instead.</p>{data.sources.length===0?<p className="muted">No previous work added yet.</p>:<ul className={styles.sources}>{data.sources.map(source=><li key={source.id} className={styles.source}><div className={styles.sourceHeading}><div><strong dir="auto">{source.title}</strong><p className="small muted">Added {source.createdAt.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})} · Text reference</p><Link className="button ghost" href={"/settings/profile/previous-work/"+source.id}>View previous work</Link></div><DeleteSource sourceId={source.id}/></div></li>)}</ul>}</div></section>
  </div>;
}
