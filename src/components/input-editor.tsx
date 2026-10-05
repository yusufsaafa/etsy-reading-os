"use client";
import { useState } from "react";
import type { Answer } from "@/modules/intake/contracts";
import { saveInput } from "@/app/actions";
import { Button } from "./ui";
export function InputEditor({ unitId, revision, initial, allocated, needsAllocation, inputLabel }: { unitId: string; revision: number; initial: Answer[]; allocated: boolean; needsAllocation: boolean; inputLabel: string }) {
  const [answers, setAnswers] = useState(initial.length ? initial : [{ label: inputLabel, value: "", kind: "text" as const }]);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  return <form action={async form => { setPending(true); setError(""); try { await saveInput(form); } catch { setError("Unable to save. Refresh to check for a newer revision, then try again."); } finally { setPending(false); } }} className="stack">
    <input type="hidden" name="unitId" value={unitId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="answers" value={JSON.stringify(answers)} />
    {answers.map((answer, i) => <div className="stack" key={i}><label>Input label<input aria-label={`Input ${i + 1} label`} maxLength={500} value={answer.label} onChange={e => setAnswers(old => old.map((a,j) => j === i ? {...a, label:e.target.value} : a))} /></label><label>{answer.label || "Customer answer"}<textarea dir="auto" maxLength={10000} value={answer.value} onChange={e => setAnswers(old => old.map((a,j) => j === i ? {...a, value:e.target.value, kind:"text"} : a))} /></label></div>)}
    {answers.length < 20 && <Button type="button" className="secondary" onClick={() => setAnswers(old => [...old, {label:"",value:"",kind:"text"}])}>Add customer field</Button>}
    {needsAllocation && <label className="check"><input type="checkbox" name="allocated" defaultChecked={allocated} />I confirmed this unit’s recipient and inputs.</label>}
    <p className="muted small">Corrections are saved as a new revision. Original purchase information remains available.</p>
    {error && <p role="alert" className="error-message">{error}</p>}<Button disabled={pending}>{pending ? "Saving…" : "Save customer information"}</Button>
  </form>;
}
