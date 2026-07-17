"use client";

import { BrainCircuit, Gauge, Headphones, Info, Network } from "lucide-react";
import styles from "./AdaptiveScoreBreakdown.module.css";

function signed(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export default function AdaptiveScoreBreakdown({ score, playback, coordination, defaultOpen = false }: { score?: any; playback?: any; coordination?: any; defaultOpen?: boolean }) {
  if (!score && !playback && !coordination) return null;
  if (score && !score.enabled && !playback?.enabled && !coordination) {
    return <div className={styles.disabled}><Info size={13} /> Personalization disabled · Base score {Math.round(score.baseScore)}</div>;
  }
  const baseScore = score?.baseScore ?? playback?.baseScore ?? 0;
  const adaptiveScore = score?.personalizedScore ?? baseScore;
  const beforeCoordination = playback?.finalScore ?? adaptiveScore;
  const finalScore = beforeCoordination + (coordination?.totalAdjustment || 0);
  const totalAdjustment = finalScore - baseScore;
  return (
    <details className={styles.details} open={defaultOpen || score?.explanationsDefaultOpen}>
      <summary>
        <span><BrainCircuit size={14} /> Smart Mix score</span>
        <span className={styles.summaryScores}>
          <small>Base {Math.round(baseScore)}</small>
          <strong>{Math.round(finalScore)}</strong>
          <em className={totalAdjustment >= 0 ? styles.positive : styles.negative}>{signed(totalAdjustment)}</em>
        </span>
      </summary>
      <div className={styles.body}>
        <div className={styles.scoreGrid}>
          <div><span>Base engine</span><strong>{Math.round(baseScore)}</strong></div>
          <div><span>Adaptive</span><strong>{Math.round(adaptiveScore)}</strong></div>
          <div><span>Final</span><strong>{Math.round(finalScore)}</strong></div>
          <div><span>Playback confidence</span><strong>{playback?.confidenceLabel || "Not used"}</strong></div>
        </div>
        {score && <div className={styles.influence}><Gauge size={13} /> Maximum influence {Math.round(score.maximumInfluence * 100)}% · adaptive model v{score.adaptiveScoringVersion}</div>}
        {score?.components?.some((component: any) => component.appliedAdjustment !== 0) ? (
          <div className={styles.components}>
            {score.components.filter((component: any) => component.appliedAdjustment !== 0).map((component: any) => (
              <div key={component.key}>
                <span>{component.label}<small>{component.confidence} confidence</small></span>
                <strong className={component.appliedAdjustment >= 0 ? styles.positive : styles.negative}>{signed(component.appliedAdjustment)}</strong>
                {component.reasons?.slice(0, 2).map((reason: any) => (
                  <p key={`${reason.source}:${reason.message}`}>{reason.message}<small>{reason.source} · {reason.scope}</small></p>
                ))}
              </div>
            ))}
          </div>
        ) : score ? <p className={styles.empty}>Mixarr does not have enough matching adaptive evidence for this track yet.</p> : null}
        {playback && <div className={styles.playback}>
          <div><span><Headphones size={13} /> Playback awareness</span><strong className={playback.appliedAdjustment >= 0 ? styles.positive : styles.negative}>{signed(playback.appliedAdjustment)}</strong></div>
          {playback.badges?.length > 0 && <p className={styles.badges}>{playback.badges.map((badge: string) => <span key={badge}>{badge}</span>)}</p>}
          {playback.reasons?.map((reason: any) => <p key={`${reason.key}:${reason.message}`}>{reason.message}<small>{signed(reason.adjustment)}</small></p>)}
          <small>{playback.observationCount} playback events · cap ±{playback.maximumAdjustment} · {playback.statusMessage}</small>
        </div>}
        {coordination && <div className={styles.playback}>
          <div><span><Network size={13} /> Playlist coordination</span><strong className={coordination.totalAdjustment >= 0 ? styles.positive : styles.negative}>{signed(coordination.totalAdjustment)}</strong></div>
          {coordination.reasons?.map((reason: string) => <p key={reason}>{reason}</p>)}
          {coordination.hardOverlapRejected && <small>Excluded by the configured hard cross-playlist overlap maximum.</small>}
        </div>}
        {score && <p className={score.adjustmentWasCapped ? styles.cap : styles.status}>{score.statusMessage}</p>}
      </div>
    </details>
  );
}
