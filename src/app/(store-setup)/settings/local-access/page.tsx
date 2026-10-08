import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope,requireUser} from "@/modules/identity/session";
import {verifyScope} from "@/modules/intake/service";
import {localAuthenticatedSubject} from "@/modules/identity/local-subject";
export const dynamic="force-dynamic";
export default async function LocalAccess(){
 if(process.env.NODE_ENV!=="development")notFound();
 const scope=await currentStoreScope();await verifyScope(database(),scope,true);
 const user=await requireUser(),subject=localAuthenticatedSubject(user.id);
 return <main className="page-content"><Link href="/settings">← Settings</Link><h1>Local operator access</h1><p>Only your authenticated subject is shown. This page grants no internal permissions.</p>
 {subject?<><p>Your GitHub authenticated subject: <code>{subject}</code></p><p>In the local server environment, explicitly set:</p><pre>{`INTERNAL_TOOLS_ENABLED=true\nINTERNAL_OPERATOR_USER_IDS=${subject}`}</pre><p>Restart the local server and sign in normally. Then open Historical Review. Keep these settings private; never use a username or a wildcard. Store ownership checks still apply.</p></>:<p>Sign in with GitHub OAuth to obtain the exact supported subject. No username or guessed account identity can enable access.</p>}
 <p className="small muted">Internal tools remain disabled unless explicitly enabled and this exact subject is allowlisted. This page is unavailable in production. No session tokens, other users or credentials are shown.</p></main>;
}
