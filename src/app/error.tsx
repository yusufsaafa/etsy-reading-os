"use client";
import { Button } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="auth-shell"><section className="card"><h1>Unable to load this view</h1><p>Check your database connection or refresh your session, then try again.</p><Button onClick={reset}>Try again</Button></section></main>; }
