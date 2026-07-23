import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AiIntelligenceCenter from "@/components/AiIntelligenceCenter";
export const dynamic = "force-dynamic";
export const metadata = { title: "AI-Assisted Mix Intelligence | Mixarr", description: "AI status, requests, providers, privacy, usage, approvals, and controls." };
export default function AiPage() { if (!cookies().get("mixarr_session")?.value) redirect("/"); return <AiIntelligenceCenter/>; }
