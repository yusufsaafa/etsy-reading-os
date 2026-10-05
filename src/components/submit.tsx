"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./ui";
export function ActionForm({ action, children, label, secondary = false }: { action: (form: FormData) => Promise<void>; children?: ReactNode; label: string; secondary?: boolean }) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  return <form className="stack" action={async form => { setPending(true); setError(""); try { await action(form); } catch { setError("Action could not complete. Check the current status and try again."); } finally { setPending(false); } }}>
    {children}<Button disabled={pending} className={secondary ? "secondary" : ""}>{pending ? "Working…" : label}</Button>{error && <p role="alert" className="error-message">{error}</p>}
  </form>;
}
