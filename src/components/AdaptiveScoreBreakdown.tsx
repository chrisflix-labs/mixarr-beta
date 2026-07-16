"use client";

import { BrainCircuit, Gauge, Info } from "lucide-react";
import styles from "./AdaptiveScoreBreakdown.module.css";

function signed(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export default function AdaptiveScoreBreakdown({ score, defaultOpen = false }: { score?: any; defaultOpen?: boolean }) {
  if (!score) return null;
  if (!score.enabled) {
    return <div className={styles.disabled}><Info size={13} /> Personalization disabled · Base score {Math.round(score.baseScore)}</div>;
  }
  return (
    <details className={styles.details} open={defaultOpen || score.explanationsDefaultOpen}>
      <summary>
        <span><BrainCircuit size={14} /> Smart Mix score</span>
        <span className={styles.summaryScores}>
          <small>Base {Math.round(score.baseScore)}</small>
          <strong>{Math.round(score.personalizedScore)}</strong>
          <em className={score.cappedAdjustment >= 0 ? styles.positive : styles.negative}>{signed(score.cappedAdjustment)}</em>
        </span>
      </summary>
      <div className={styles.body}>
        <div className={styles.scoreGrid}>
          <div><span>Base engine</span><strong>{Math.round(score.baseScore)}</strong></div>
          <div><span>Personalized</span><strong>{Math.round(score.personalizedScore)}</strong></div>
          <div><span>Adjustment</span><strong>{signed(score.cappedAdjustment)}</strong></div>
          <div><span>Confidence</span><strong>{score.confidence}</strong></div>
        </div>
        <div className={styles.influence}><Gauge size={13} /> Maximum influence {Math.round(score.maximumInfluence * 100)}% · model v{score.adaptiveScoringVersion}</div>
        {score.components?.some((component: any) => component.appliedAdjustment !== 0) ? (
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
        ) : <p className={styles.empty}>Mixarr does not have enough matching evidence for this track yet.</p>}
        <p className={score.adjustmentWasCapped ? styles.cap : styles.status}>{score.statusMessage}</p>
      </div>
    </details>
  );
}
