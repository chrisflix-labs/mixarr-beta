"use client";

import { useState } from "react";
import { AlertTriangle, BarChart3, ChevronDown, Database, Filter, ShieldCheck, Sparkles } from "lucide-react";
import type { SmartMixGenerationInsights } from "@/lib/smartMixExplanations/types";
import SmartMixExplanation from "./SmartMixExplanation";
import styles from "./SmartMixGenerationInsights.module.css";

type RejectedCandidate = { trackId: string; title: string; artist: string | null; finalScore: number; confidence: { score: number; label: string }; rejectionStage?: string; rejectionCode?: string; summary: string };

export default function SmartMixGenerationInsights({ insights, generationId, rejectedCandidates = [] }: { insights?: SmartMixGenerationInsights | null; generationId: string; rejectedCandidates?: RejectedCandidate[] }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<"all" | "low" | "fallback" | "metadata" | "rejected">("all");
  if (!insights) return null;
  const rejected = filter === "low" ? rejectedCandidates.filter((item) => item.confidence.score < 55) : rejectedCandidates;
  return <section className={styles.panel} aria-labelledby={`insights-${generationId}`}>
    <button className={styles.heading} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className={styles.icon}><BarChart3 size={20} /></span><span><strong id={`insights-${generationId}`}>Generation Insights</strong><small>{insights.candidatesEvaluated.toLocaleString()} evaluated · {insights.selectedCount} selected · {insights.averageConfidence}% average confidence</small></span><ChevronDown className={expanded ? styles.rotated : ""} />
    </button>
    {expanded && <div className={styles.content}>
      <div className={styles.metrics}>
        <Metric label="Evaluated" value={insights.candidatesEvaluated} icon={<BarChart3 />} />
        <Metric label="Eligible" value={insights.eligibleCandidates} icon={<ShieldCheck />} />
        <Metric label="Hard rejected" value={insights.hardRejectedCount} icon={<AlertTriangle />} />
        <Metric label="Ranking rejected" value={insights.rankingRejectedCount} icon={<Filter />} />
        <Metric label="Fallback tracks" value={insights.fallbackTrackCount} icon={<Sparkles />} />
        <Metric label="Missing metadata" value={insights.missingMetadataTrackCount} icon={<Database />} />
      </div>
      <div className={styles.columns}>
        <div><h4>Largest influences</h4><ol>{insights.mostInfluentialFactors.slice(0, 5).map((factor) => <li key={factor.code}><span>{factor.label}</span><b>{factor.totalContribution.toFixed(1)} pts</b></li>)}</ol></div>
        <div><h4>Most common rejection reasons</h4>{insights.rejectionReasons.length ? <ol>{insights.rejectionReasons.slice(0, 5).map((reason) => <li key={reason.code}><span>{reason.code.replaceAll("_", " ").toLowerCase()}</span><b>{reason.count}</b></li>)}</ol> : <p>No retained rejection reasons.</p>}</div>
      </div>
      <div className={styles.filters} aria-label="Insight filters">{([['all','All decisions'],['low','Low confidence'],['fallback','Fallbacks'],['metadata','Missing metadata'],['rejected','Rejected candidates']] as const).map(([key,label]) => <button key={key} onClick={() => setFilter(key)} className={filter === key ? styles.active : ""}>{label}</button>)}</div>
      {(filter === "all" || filter === "low") && insights.lowestConfidenceTracks.length > 0 && <div><h4>Lowest-confidence selections</h4><div className={styles.rows}>{insights.lowestConfidenceTracks.map((track) => <div key={track.trackId}><span><strong>{track.trackTitle}</strong><small>{track.confidence}% confidence</small></span><SmartMixExplanation compact trackId={track.trackId} generationId={generationId} /></div>)}</div></div>}
      {filter === "fallback" && <p>{insights.fallbackTrackCount ? `${insights.fallbackTrackCount} selected track${insights.fallbackTrackCount === 1 ? " used" : "s used"} fallback logic. Open a track explanation to see the exact stable fallback codes.` : "No selected track required fallback logic."}</p>}
      {filter === "metadata" && <div><h4>Metadata problems</h4>{insights.metadataProblems.length ? <ul>{insights.metadataProblems.map((item) => <li key={item.field}>{item.field}: {item.count} affected decision{item.count === 1 ? "" : "s"}</li>)}</ul> : <p>No retained metadata problems affected selected tracks.</p>}</div>}
      {(filter === "rejected" || filter === "all" || filter === "low") && rejected.length > 0 && <div><h4>Rejected candidates</h4><div className={styles.rows}>{rejected.slice(0, 25).map((candidate) => <div key={candidate.trackId}><span><strong>{candidate.title}</strong><small>{candidate.artist || "Unknown artist"} · {candidate.rejectionCode?.replaceAll("_", " ").toLowerCase()}</small></span><SmartMixExplanation compact decision="rejected" trackId={candidate.trackId} generationId={generationId} /></div>)}</div></div>}
      <p className={styles.retention}>Selected explanations are retained with playlist history. Detailed rejected-candidate traces use your configured retention window; aggregate insights remain available.</p>
    </div>}
  </section>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div>{icon}<span><strong>{value.toLocaleString()}</strong><small>{label}</small></span></div>; }
