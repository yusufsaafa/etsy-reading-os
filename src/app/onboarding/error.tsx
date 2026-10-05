"use client";
import { Button } from "@/components/ui";
export default function Error({ reset }: { reset: () => void }) { return <div role="alert"><h1>Store setup couldn't load</h1><p>Try again. Your saved store and product selection won't be changed.</p><Button onClick={() => reset()}>Try again</Button></div>; }
