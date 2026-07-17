"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, Download, Minus, Plus, X, XCircle } from "lucide-react";
import type { SmartMixDecisionExplanation, SmartMixExplanationDetailLevel } from "@/lib/smartMixExplanations/types";
import styles from "./SmartMixExplanation.module.css";

type Props = {
  trackId: string;
  generationId?: string | null;
  playlistId?: string | null;
  decision?: "selected" | "rejected" | "replaced";
  initialExplanation?: SmartMixDecisionExplanation | null;
  compact?: boolean;
};

const tabs = ["Summary", "Scores", "Transition", "Metadata", "Advanced"] as const;
type Tab = typeof tabs[number];

function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(1)}`; }

export default function SmartMixExplanation({ trackId, generationId, playlistId, decision = "selected", initialExplanation, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Summary");
  const [explanation, setExplanation] = useState(initialExplanation || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailLevel, setDetailLevel] = useState<SmartMixExplanationDetailLevel>("SIMPLE");
  const [developerAvailable, setDeveloperAvailable] = useState(false);
  const [comparison, setComparison] = useState<any>(null);

  useEffect(() => { setExplanation(initialExplanation || null); }, [initialExplanation]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  async function openExplanation() {
    setOpen(true); setError("");
    if (!explanation) {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (generationId) query.set("generationId", generationId);
        if (playlistId) query.set("playlistId", playlistId);
        const response = await axios.get(`/api/smart-mix-explanations/tracks/${trackId}?${query}`);
        setExplanation(response.data.explanation);
      } catch (requestError: any) { setError(requestError.response?.data?.error || "The explanation could not be loaded."); }
      finally { setLoading(false); }
    }
    try {
      const response = await axios.get("/api/settings/smart-mix-explanations");
      setDetailLevel(response.data.preference.detailLevel || "SIMPLE");
      setDeveloperAvailable(Boolean(response.data.developerModeAvailable));
    } catch { /* The drawer remains usable with the simple default. */ }
  }

  async function compareWith(candidateId: string) {
    if (!generationId) return;
    try { const response = await axios.post("/api/smart-mix-explanations/compare", { generationId, trackIds: [trackId, candidateId] }); setComparison(response.data.comparison); setTab("Scores"); }
    catch (requestError: any) { setError(requestError.response?.data?.error || "Candidate comparison is unavailable."); }
  }

  const visibleFactors = useMemo(() => {
    if (!explanation) return [];
    if (detailLevel === "SIMPLE") return explanation.factors.filter((factor) => factor.impact !== "neutral").slice(0, 6);
    return explanation.factors;
  }, [detailLevel, explanation]);
  const positives = visibleFactors.filter((factor) => factor.impact === "positive" && factor.code !== "BASE_COMPATIBILITY");
  const negatives = visibleFactors.filter((factor) => factor.impact === "negative");

  return <>
    <button type="button" className={compact ? styles.compactButton : styles.button} onClick={openExplanation} aria-label={`${decision === "selected" ? "Why selected" : "Why rejected"}: open Smart Mix explanation`}>
      <CircleHelp size={15} aria-hidden="true" /> {decision === "selected" ? "Why selected?" : decision === "replaced" ? "Why replaced?" : "Why rejected?"}
    </button>
    {open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="smart-mix-explanation-title">
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>Smart Mix decision trace</span><h2 id="smart-mix-explanation-title">{explanation?.trackTitle || "Track explanation"}</h2><p>{explanation?.artistName || "Generation-time scoring details"}</p></div>
          <button autoFocus className={styles.close} onClick={() => setOpen(false)} aria-label="Close explanation"><X size={20} /></button>
        </header>
        <div className={styles.toolbar}>
          <div className={styles.detailControl} aria-label="Explanation detail level">
            {(["SIMPLE", "DETAILED", ...(developerAvailable ? ["DEVELOPER"] : [])] as SmartMixExplanationDetailLevel[]).map((level) => <button key={level} className={detailLevel === level ? styles.activeChoice : ""} onClick={() => setDetailLevel(level)}>{level[0] + level.slice(1).toLowerCase()}</button>)}
          </div>
          {generationId && <a className={styles.export} href={`/api/smart-mix-explanations/generations/${generationId}/export`} title="Contains listening preferences; review before sharing"><Download size={15} /> Debug JSON</a>}
          <Link className={styles.export} href="/personalization">Personalization dashboard</Link>
        </div>
        <nav className={styles.tabs} aria-label="Explanation sections">{tabs.map((item) => <button key={item} aria-current={tab === item ? "page" : undefined} className={tab === item ? styles.activeTab : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <div className={styles.body}>
          {loading && <div className={styles.state}>Building the explanation view from the saved generation trace…</div>}
          {error && <div className={styles.error} role="alert"><AlertTriangle size={18} />{error}</div>}
          {!loading && !error && !explanation && <div className={styles.state}>Detailed explanations are unavailable. This may be a historical Smart Mix v1 playlist or an expired candidate trace.</div>}
          {explanation && tab === "Summary" && <>
            <div className={styles.hero}>
              <div className={explanation.decision === "selected" ? styles.selectedIcon : styles.rejectedIcon}>{explanation.decision === "selected" ? <CheckCircle2 /> : <XCircle />}</div>
              <div><span className={styles.status}>{explanation.decision === "selected" ? "Selected" : explanation.rejectionStage === "final_ranking" ? "Soft rejection" : "Hard rejection"}{explanation.rank ? ` · Rank ${explanation.rank}` : ""}</span><p>{explanation.summary}</p></div>
              <div className={styles.score}><strong>{explanation.scores.finalScore.toFixed(1)}</strong><span>final score</span></div>
            </div>
            <div className={styles.confidence}><div><strong>Recommendation confidence: {explanation.confidence.label}</strong><span>{explanation.confidence.score}%</span></div><div className={styles.meter}><i style={{ width: `${explanation.confidence.score}%` }} /></div><ul>{explanation.confidence.reasons.slice(0, detailLevel === "SIMPLE" ? 2 : undefined).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
            <FactorGroup title="Strongest reasons" factors={positives} positive />
            <FactorGroup title="Factors working against it" factors={negatives} />
            {explanation.fallbacks.length > 0 && <section className={styles.warningSection}><h3><AlertTriangle size={17} /> Fallbacks disclosed</h3>{explanation.fallbacks.map((fallback) => <p key={fallback.code}><strong>{fallback.code.replaceAll("_", " ")}</strong> — {fallback.behaviorUsed}{fallback.relaxedRule ? " This relaxed a configured constraint." : ""}</p>)}</section>}
            {explanation.suggestedFixes.length > 0 && <section><h3>Suggested improvements</h3><div className={styles.actions}>{explanation.suggestedFixes.map((fix) => <a key={fix.code} href={fix.href}>{fix.label}<ChevronRight size={15} /></a>)}</div></section>}
          </>}
          {explanation && tab === "Scores" && <>
            <section><h3>Score calculation</h3><div className={styles.scoreGrid}>
              <ScoreRow label="Base score" value={explanation.scores.baseScore} />
              <ScoreRow label="Personalization" value={explanation.scores.personalizationAdjustment} signed />
              <ScoreRow label="Playlist identity" value={explanation.scores.playlistIdentityAdjustment} signed />
              <ScoreRow label="Transition" value={explanation.scores.transitionAdjustment} signed />
              <ScoreRow label="Other adjustments & penalties" value={explanation.scores.penaltyAdjustment} signed />
              <ScoreRow label="Final score" value={explanation.scores.finalScore} final />
            </div></section>
            <section><h3>Factor contributions</h3><div className={styles.factorTable}>{visibleFactors.map((factor) => <div key={`${factor.code}-${factor.explanation}`} className={styles.factorRow}><span className={factor.impact === "positive" ? styles.plus : factor.impact === "negative" ? styles.minus : styles.neutral}>{factor.impact === "positive" ? <Plus /> : factor.impact === "negative" ? <Minus /> : <CircleHelp />}</span><div><strong>{factor.label}</strong><p>{factor.explanation}</p>{detailLevel === "DEVELOPER" && <code>{factor.code} · weight {factor.weight} · confidence {Math.round(factor.sourceConfidence * 100)}%</code>}</div><b>{signed(factor.weightedContribution)}</b></div>)}</div></section>
            <section><h3>Personalization influence</h3><p>{explanation.personalization.statusMessage}</p><dl className={styles.inlineFacts}><div><dt>Maximum influence</dt><dd>{explanation.personalization.maximumInfluence ?? "Not configured"}</dd></div><div><dt>Confidence limit</dt><dd>{explanation.personalization.appliedConfidenceLimit || "None"}</dd></div><div><dt>Capped</dt><dd>{explanation.personalization.adjustmentWasCapped ? "Yes" : "No"}</dd></div></dl></section>
            <section><h3>Playlist identity</h3><p>{explanation.playlistIdentity.applied ? `Identity was ${explanation.playlistIdentity.influence.replaceAll("_", " ")}.` : "Playlist identity was disabled or unavailable for this generation."}</p>{explanation.playlistIdentity.reasons.length > 0 && <ul>{explanation.playlistIdentity.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</section>
            {explanation.comparisons.map((candidate) => <button key={candidate.candidateId} className={styles.compareButton} onClick={() => compareWith(candidate.candidateId)}>Compare with {candidate.candidateTitle || "competing candidate"}</button>)}
            {comparison && <section><h3>Candidate comparison</h3><p>{comparison.summary}</p><div className={styles.comparison}>{comparison.factors.slice(0, 12).map((row: any) => <div key={row.code}><span>{row.label}</span><b>{signed(row.candidateA)}</b><b>{signed(row.candidateB)}</b><strong>{signed(row.difference)}</strong></div>)}</div></section>}
          </>}
          {explanation && tab === "Transition" && <section><h3>Track-to-track transition</h3>{explanation.transition ? <><dl className={styles.transitionGrid}><div><dt>Previous track</dt><dd>{explanation.transition.previousTrackTitle || "Previous selected track"}</dd></div><div><dt>BPM</dt><dd>{explanation.transition.fromBpm ?? "Unknown"} → {explanation.transition.toBpm ?? "Unknown"}</dd></div><div><dt>Raw difference</dt><dd>{explanation.transition.rawBpmDifference ?? "Unknown"} BPM</dd></div><div><dt>Effective difference</dt><dd>{explanation.transition.effectiveBpmDifference ?? "Unknown"} BPM</dd></div><div><dt>Relationship</dt><dd>{explanation.transition.relationship}</dd></div><div><dt>Difficulty</dt><dd>{explanation.transition.difficulty}</dd></div><div><dt>Transition score</dt><dd>{explanation.transition.transitionScore == null ? "Unavailable" : `${explanation.transition.transitionScore}%`}</dd></div><div><dt>Ramp direction</dt><dd>{explanation.transition.direction}</dd></div></dl>{explanation.transition.relationship !== "direct" && explanation.transition.relationship !== "unknown" && <p className={styles.note}>Mixarr treated the BPM values as compatible using {explanation.transition.relationship} matching.</p>}{explanation.transition.warning && <div className={styles.error}><AlertTriangle size={18} />{explanation.transition.warning}</div>}</> : <div className={styles.state}>Transition context is unavailable for this candidate or first playlist position.</div>}</section>}
          {explanation && tab === "Metadata" && <><section><h3>Generation-time metadata</h3>{explanation.missingMetadata.length === 0 ? <p><CheckCircle2 size={16} /> Core scoring metadata was available.</p> : <div className={styles.metadataCards}>{explanation.missingMetadata.map((item) => <article key={item.field}><strong>{item.field.toUpperCase()} · {item.status.replaceAll("_", " ")}</strong><p>Fallback used: {item.fallbackUsed ? "Yes" : "No"}. Confidence impact: {item.confidenceImpact} points.</p>{item.suggestedFix && <a href={item.suggestedFix.href}>{item.suggestedFix.label}</a>}</article>)}</div>}</section><section><h3>Fallback behavior</h3>{explanation.fallbacks.length ? explanation.fallbacks.map((fallback) => <article className={styles.fallback} key={fallback.code}><code>{fallback.code}</code><p><strong>Trigger:</strong> {fallback.trigger}</p><p><strong>Behavior used:</strong> {fallback.behaviorUsed}</p></article>) : <p>No fallback behavior was used.</p>}</section></>}
          {explanation && tab === "Advanced" && <section><h3>Immutable trace details</h3><dl className={styles.inlineFacts}><div><dt>Generation ID</dt><dd>{explanation.generationId}</dd></div><div><dt>Engine</dt><dd>{explanation.engineVersion}</dd></div><div><dt>Schema</dt><dd>{explanation.schemaVersion}</dd></div><div><dt>Decision</dt><dd>{explanation.decision}</dd></div><div><dt>Rejection stage</dt><dd>{explanation.rejectionStage || "Not applicable"}</dd></div><div><dt>Rejection code</dt><dd>{explanation.rejectionCode || "Not applicable"}</dd></div><div><dt>Captured</dt><dd>{new Date(explanation.createdAt).toLocaleString()}</dd></div></dl><p className={styles.note}>This trace reflects the settings, identity, personalization state, and metadata available at generation time. Later changes do not rewrite it.</p>{detailLevel === "DEVELOPER" ? <pre className={styles.raw}>{JSON.stringify(explanation, null, 2)}</pre> : <p>Developer raw data is restricted to administrators.</p>}</section>}
        </div>
      </section>
    </div>}
  </>;
}

function FactorGroup({ title, factors, positive }: { title: string; factors: SmartMixDecisionExplanation["factors"]; positive?: boolean }) {
  if (!factors.length) return null;
  return <section><h3>{title}</h3><div className={styles.reasonList}>{factors.map((factor) => <article key={`${factor.code}-${factor.explanation}`}><span className={positive ? styles.good : styles.bad}>{positive ? <CheckCircle2 size={17} /> : <Minus size={17} />}</span><div><strong>{factor.label}</strong><p>{factor.explanation}</p></div><b>{signed(factor.weightedContribution)}</b></article>)}</div></section>;
}

function ScoreRow({ label, value, signed: showSign, final }: { label: string; value: number; signed?: boolean; final?: boolean }) { return <div className={final ? styles.finalScore : ""}><span>{label}</span><strong>{showSign ? signed(value) : value.toFixed(1)}</strong></div>; }
