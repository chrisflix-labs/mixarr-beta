import type { Metadata } from "next";
import { cookies } from "next/headers";
import PersonalizationDashboard from "@/components/PersonalizationDashboard";
import { getPersonalizationDashboardSummary } from "@/lib/personalization/dashboard";
import styles from "./personalization.module.css";

export const metadata: Metadata = { title: "Personalization | Mixarr", description: "Understand and control personalization stored in your configured Mixarr environment." };
export const dynamic = "force-dynamic";

export default async function PersonalizationPage() {
  const userId = cookies().get("mixarr_session")?.value;
  const summary = userId ? await getPersonalizationDashboardSummary(userId).catch(() => null) : null;
  return <div className={styles.wrapper}>{summary ? <PersonalizationDashboard initialSummary={summary} /> : <section className="glass-panel"><h2>Personalization</h2><p>Connect your Plex account and apply the v2.1.10 database migration to view your personalization dashboard.</p></section>}</div>;
}
