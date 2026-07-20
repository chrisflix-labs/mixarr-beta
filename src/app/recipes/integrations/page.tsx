import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, AudioWaveform, CheckCircle2, PlugZap } from "lucide-react";
import prisma from "@/lib/prisma";
import { getRecipeLibraryProfile } from "@/lib/recipeStudioService";
import styles from "../recipe-tools.module.css";

export const dynamic = "force-dynamic";

export default async function RecipeIntegrationStatusPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return <main className={styles.state}>Sign in to view recipe integration status.</main>;
  const [profile, recipes, servers] = await Promise.all([
    getRecipeLibraryProfile(userId),
    prisma.playlistRecipe.findMany({ where: { userId, isArchived: false, deletedAt: null }, select: { id: true, name: true, dependencyStatusJson: true, bpmFlowJson: true, targetsJson: true } }),
    prisma.server.findMany({ where: { userId }, select: { id: true, name: true, enabled: true, availabilityState: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true } }),
  ]);
  const dependencies = recipes.flatMap((recipe) => Array.isArray(recipe.dependencyStatusJson) ? (recipe.dependencyStatusJson as any[]).map((dependency) => ({ ...dependency, recipeId: recipe.id, recipeName: recipe.name })) : []);
  const groupedMap = dependencies.reduce((map, item) => { const key = `${item.type}:${item.name}`; const current = map.get(key) || { ...item, recipes: [] }; current.recipes.push({ id: item.recipeId, name: item.recipeName }); map.set(key, current); return map; }, new Map<string, any>());
  const grouped: any[] = Array.from(groupedMap.values());
  const coverage = [
    { name: "BPM metadata", value: profile.totalTracks ? Math.round(profile.bpmTracks / profile.totalTracks * 100) : 0, affected: recipes.filter((recipe: any) => recipe.bpmFlowJson?.mode && recipe.bpmFlowJson.mode !== "DISABLED").length },
    { name: "Mood metadata", value: profile.totalTracks ? Math.round(profile.moodTracks / profile.totalTracks * 100) : 0, affected: recipes.filter((recipe: any) => recipe.targetsJson?.strictMoodMatching).length },
    { name: "Energy metadata", value: profile.totalTracks ? Math.round(profile.energyTracks / profile.totalTracks * 100) : 0, affected: recipes.filter((recipe: any) => recipe.targetsJson?.minimumEnergy != null || recipe.targetsJson?.maximumEnergy != null).length },
  ];
  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/recipes"><ArrowLeft size={15} />Recipe Library</Link><span><PlugZap size={15} />Recipe dependencies</span><h1>Recipe integration status</h1><p>Connected services, metadata capabilities, affected recipes, and remediation.</p></div><Link className={styles.primary} href="/settings/integrations">Manage integrations</Link></header>
    <section className={styles.summaryGrid}>{coverage.map((item) => <article key={item.name} style={{ padding: ".8rem", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", background: "var(--panel)" }}><AudioWaveform /><span>{item.name}</span><strong>{item.value}%</strong><small>{item.affected} recipe(s) depend on it</small></article>)}</section>
    <section className={styles.analyticsGrid}><article><h2>Plex servers</h2>{servers.map((server) => <div className={styles.analyticsRow} key={server.id}><span><strong>{server.name}</strong><small>Last success {server.lastSuccessAt?.toLocaleString() || "never"}{server.lastFailureReason ? ` · ${server.lastFailureReason}` : ""}</small></span><b>{server.enabled ? server.availabilityState : "DISABLED"}</b></div>)}</article><article><h2>Declared recipe dependencies</h2>{grouped.length ? grouped.map((dependency) => <div className={styles.analyticsRow} key={`${dependency.type}-${dependency.name}`}><span><strong>{dependency.name}</strong><small>{dependency.type} · {dependency.recipes.length} recipe(s) · {dependency.message}</small></span>{dependency.status === "AVAILABLE" ? <CheckCircle2 /> : <AlertTriangle />}</div>) : <p>No external recipe dependencies are declared.</p>}</article></section>
  </main>;
}
