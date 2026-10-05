import Link from "next/link";
export default function NotFound() { return <main className="auth-shell"><h1>This resource is unavailable</h1><p>Check that you are in the correct workspace.</p><Link className="button" href="/orders">Return to orders</Link></main>; }
