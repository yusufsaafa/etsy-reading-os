"use client";
export default function DeliveryErrorPage({reset}:{reset:()=>void}){return <section className="card"><h1>Deliveries unavailable</h1><p role="alert">Delivery information could not be loaded. Try again or ask your workspace administrator to check database migrations and document storage.</p><button className="button" onClick={reset}>Try again</button></section>;}
