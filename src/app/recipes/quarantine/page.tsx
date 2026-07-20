"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, GitBranch, Loader2, RefreshCw, ShieldX, Trash2, XCircle } from "lucide-react";
import styles from "./quarantine.module.css";

type QuarantinedRecipe = { id: string; name: string; recipeSource: string; trustState: string; approvalState: string; quarantineReason?: string | null; signatureStatus: string; compatibilityStatus: string; riskLevel: string; riskScore: number; riskFindingsJson: any[]; dependencyStatusJson: any[]; requestedPermissionsJson: any[]; lastValidatedAt?: string | null; originalPayloadJson?: unknown };

export default function RecipeQuarantinePage() {
  const [recipes, setRecipes] = useState<QuarantinedRecipe[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => { try { setRecipes((await axios.get("/api/recipes/quarantine")).data.recipes || []); } catch (caught: any) { setError(caught.response?.data?.error || "Quarantined recipes could not be loaded."); } };
  useEffect(() => { void load(); }, []);

  const act = async (id: string, action: "approve" | "reject" | "revalidate" | "migrate" | "delete") => {
    setBusy(id); setError("");
    try {
      if (action === "approve") await axios.post(`/api/recipes/${id}/approval`, { mode: "suggest_only", grantedPermissions: [], confirmConsequences: [] });
      else if (action === "reject") { const reason = window.prompt("Why is this recipe being rejected?"); if (!reason) return; await axios.post(`/api/recipes/${id}/reject`, { reason }); }
      else if (action === "revalidate") await axios.post(`/api/recipes/${id}/revalidate`);
      else if (action === "migrate") {
        const preview = (await axios.get(`/api/recipes/${id}/migration`)).data;
        if (!preview.normalized || preview.errors?.length) throw new Error(preview.errors?.[0]?.message || "This recipe cannot be migrated safely.");
        const changes = (preview.changes || []).map((item: any) => item.message).join("\n") || "Normalize to the current schema.";
        if (!window.confirm(`Apply this migration?\n\n${changes}\n\nThe original payload and a restore snapshot will be preserved. The recipe remains disabled pending review.`)) return;
        await axios.post(`/api/recipes/${id}/migration`, { diffHash: preview.diffHash });
      } else {
        if (!window.confirm("Delete this quarantined copy? Its audit records are retained, but the recipe will leave the active library.")) return;
        await axios.delete(`/api/playlist-recipes/${id}`);
      }
      await load();
    } catch (caught: any) { setError(caught.response?.data?.error || caught.message || "The recipe action failed."); }
    finally { setBusy(""); }
  };

  const download = (recipe: QuarantinedRecipe) => {
    const blob = new Blob([JSON.stringify(recipe.originalPayloadJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${recipe.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-original.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className={styles.page}>
    <header><div><Link href="/recipes"><ArrowLeft size={15} /> Recipe Library</Link><h1>Recipe Quarantine</h1><p>Unsafe, invalid, unsigned, incompatible, or unapproved recipes remain inert until they pass local review.</p></div><ShieldX size={42} /></header>
    {error && <div className={styles.error}><AlertTriangle /> {error}</div>}
    {recipes.length === 0 ? <section className={styles.empty}><CheckCircle2 /><h2>Quarantine is empty</h2><p>No recipes currently require governance review.</p></section> : <section className={styles.list}>{recipes.map((recipe) => <article key={recipe.id}>
      <header><div><h2>{recipe.name}</h2><p>{recipe.recipeSource.replaceAll("_", " ")} · {recipe.trustState.replaceAll("_", " ")} · {recipe.riskLevel} risk ({recipe.riskScore}/100)</p></div><span>{recipe.approvalState.replaceAll("_", " ")}</span></header>
      <div className={styles.alert}><AlertTriangle /><div><strong>Why it is quarantined</strong><p>{recipe.quarantineReason || "Local review is required."}</p></div></div>
      <dl><div><dt>Signature</dt><dd>{recipe.signatureStatus.replaceAll("_", " ")}</dd></div><div><dt>Compatibility</dt><dd>{recipe.compatibilityStatus.replaceAll("_", " ")}</dd></div><div><dt>Last validation</dt><dd>{recipe.lastValidatedAt ? new Date(recipe.lastValidatedAt).toLocaleString() : "Not recorded"}</dd></div></dl>
      <section><h3>Requested permissions</h3>{recipe.requestedPermissionsJson.map((item: any) => <p key={item.permission || item}>{item.permission || item} {item.riskLevel ? `· ${item.riskLevel} · ${item.decision}` : ""}</p>)}</section>
      {recipe.riskFindingsJson.length > 0 && <section><h3>Findings</h3>{recipe.riskFindingsJson.map((finding: any, index) => <p key={`${finding.code}-${index}`}><b>{finding.severity || "warning"}:</b> {finding.message}</p>)}</section>}
      <details><summary>Inspect original payload</summary><pre>{JSON.stringify(recipe.originalPayloadJson, null, 2)}</pre></details>
      <footer><Link href={`/recipes/${recipe.id}`}>Review and correct</Link><button onClick={() => download(recipe)}><Download /> Export original</button><button onClick={() => void act(recipe.id, "revalidate")} disabled={busy === recipe.id}>{busy === recipe.id ? <Loader2 className={styles.spin} /> : <RefreshCw />} Revalidate</button><button onClick={() => void act(recipe.id, "migrate")} disabled={busy === recipe.id}><GitBranch /> Preview and migrate</button><button onClick={() => void act(recipe.id, "approve")} disabled={busy === recipe.id}><CheckCircle2 /> Approve with Suggest-Only restrictions</button><button className={styles.reject} onClick={() => void act(recipe.id, "reject")} disabled={busy === recipe.id}><XCircle /> Reject</button><button className={styles.reject} onClick={() => void act(recipe.id, "delete")} disabled={busy === recipe.id}><Trash2 /> Delete quarantined copy</button></footer>
    </article>)}</section>}
  </main>;
}
