"use client";
import { useActionState, useState } from "react";
import { prepareReading } from "./actions";
import { Button } from "../ui";
export function PrepareForm({unitId,retryGenerationId}:{unitId:string;retryGenerationId?:string}) {
 const [commandKey]=useState(()=>crypto.randomUUID());
 const [state,action,pending]=useActionState(prepareReading,{message:""});
 return <form action={action}><input type="hidden" name="unitId" value={unitId}/><input type="hidden" name="commandKey" value={commandKey}/>
  {retryGenerationId&&<input type="hidden" name="retryGenerationId" value={retryGenerationId}/>}
  <Button disabled={pending}>{pending?"Preparing…":retryGenerationId?"Try preparing again":"Prepare reading"}</Button>
  {state.message&&<p className="small muted" role="status">{state.message}</p>}
 </form>;
}
