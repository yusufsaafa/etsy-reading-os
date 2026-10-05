import { redirect } from "next/navigation";
export default async function StorePage({ searchParams }: { searchParams: Promise<{notice?:string}> }) { const {notice}=await searchParams; redirect(`/settings${notice ? `?notice=${encodeURIComponent(notice)}` : ""}`); }
