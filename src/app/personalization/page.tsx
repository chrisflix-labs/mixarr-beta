import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Brain } from "lucide-react";
import PersonalizationProfilePanel from "@/components/PersonalizationProfilePanel";
import { getPersonalizationProfileSummary } from "@/lib/personalization";
import styles from "./personalization.module.css";

export const metadata: Metadata = { title: "Personalization Profile | Mixarr", description: "View and control locally stored Mixarr recommendation preferences." };

export default async function PersonalizationPage() {
  const userId = cookies().get("mixarr_session")?.value;
  const summary = userId ? await getPersonalizationProfileSummary(userId).catch(() => null) : null;
  return <div className={styles.wrapper}><header><h2><Brain size={28} color="var(--accent)" /> Personalization Profile</h2><p>Understand the small, explainable adjustments Mixarr can apply to Smart Mix recommendations.</p></header>{summary ? <section className="glass-panel"><PersonalizationProfilePanel initialData={summary} detailed /></section> : <section className="glass-panel"><p>Connect your Plex account to view your personalization profile.</p></section>}</div>;
}

