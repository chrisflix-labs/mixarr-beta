import { cookies } from "next/headers";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSmartActionSettings, getSmartActionSummary, listSmartActions } from "@/lib/smartActions";
import SmartActionCenter from "@/components/SmartActionCenter";
import styles from "./smart-actions.module.css";

export const dynamic = "force-dynamic";
export default async function SmartActionsPage({ searchParams }: { searchParams?: { status?: string; confidence?: string; actionType?: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return <main className={styles.page}><section className={styles.empty}><ListChecks size={36} /><h1>Smart Actions</h1><p>Connect Plex to review explainable playlist and library recommendations.</p><Link href="/">Return to dashboard</Link></section></main>;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return <main className={styles.page}><section className={styles.empty}><h1>Session unavailable</h1><p>Please reconnect your Plex account.</p></section></main>;
  const initialFilters = { status: searchParams?.status || "", confidence: searchParams?.confidence || "", actionType: searchParams?.actionType || "" };
  const [summary, queue, settings] = await Promise.all([getSmartActionSummary(userId), listSmartActions(userId, initialFilters), getSmartActionSettings(userId)]);
  return <SmartActionCenter initialSummary={summary} initialQueue={queue} initialEnabled={settings.enabled} initialFilters={initialFilters} />;
}
