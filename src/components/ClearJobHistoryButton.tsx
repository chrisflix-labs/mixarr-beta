"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import styles from "@/app/jobs/jobs.module.css";

export default function ClearJobHistoryButton({ clearableCount }: { clearableCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function clearHistory() {
    setClearing(true);
    setMessage("");
    setFailed(false);

    try {
      const response = await fetch("/api/jobs/history", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Failed to clear job history.");

      setConfirming(false);
      setMessage((data.deleted || 0) > 0 ? "Job history cleared." : "No completed jobs to clear.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("Failed to clear job history.");
    } finally {
      setClearing(false);
    }
  }

  if (clearableCount <= 0 && !message) return null;

  return (
    <div className={styles.historyActions}>
      {clearableCount > 0 && (
        <button type="button" className={styles.dangerButton} onClick={() => setConfirming(true)} disabled={clearing}>
          <Trash2 size={14} />
          Clear History
        </button>
      )}

      {message && (
        <span className={`${styles.actionMessage} ${failed ? styles.actionError : ""}`} role="status" aria-live="polite">
          {message}
        </span>
      )}

      {confirming && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => !clearing && setConfirming(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
            aria-describedby="clear-history-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="clear-history-title">Clear job history?</h3>
            <p id="clear-history-description">
              This will remove completed, failed, cancelled, and other finished jobs from the history list. Active or running jobs will not be removed.
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setConfirming(false)} disabled={clearing}>
                Cancel
              </button>
              <button type="button" className={styles.dangerButton} onClick={() => void clearHistory()} disabled={clearing}>
                {clearing ? "Clearing..." : "Clear History"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
