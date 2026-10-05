import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Reading OS", template: "%s · Reading OS" }, description: "Personalized digital order operations" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
