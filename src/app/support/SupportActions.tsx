"use client";

import { useMemo, useState } from "react";
import { Clipboard, Download } from "lucide-react";
import styles from "./support.module.css";
import { tryCopyTextToClipboard } from "@/lib/clipboard";

type Props = {
  summary: {
    links: {
      discordSupportUrl?: string | null;
      discordConfigured?: boolean;
    };
  };
};

async function readTextResponse(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to generate diagnostics. Check logs or try again.");
  }
  return response.text();
}

export default function SupportActions({ summary }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const route = typeof window === "undefined" ? "/support" : window.location.pathname;
  const templateUrl = useMemo(() => `/api/support/bug-report-template?route=${encodeURIComponent(route)}`, [route]);
  const feedbackUrl = useMemo(() => `/api/support/bug-report-template?type=feedback&route=${encodeURIComponent(route)}`, [route]);

  async function copyFrom(url: string, key: string) {
    setWorking(key);
    setMessage(null);
    setManualText(null);
    let text: string | null = null;
    try {
      text = await readTextResponse(url);
      const result = await tryCopyTextToClipboard(text);
      if (!result.ok) {
        setManualText(text);
        setMessage(result.reason === "not-secure-context" ? "Automatic clipboard access is unavailable here. Select and copy manually." : "Automatic copying was blocked. Select and copy manually.");
        return;
      }
      setMessage("Copied to clipboard.");
    } catch (error) {
      // Generation and copying are separate stages. A successfully generated
      // template stays available even if the browser refuses both copy paths.
      if (text) setManualText(text);
      setMessage(error instanceof Error ? error.message : "Copy failed. Select and copy manually.");
    } finally {
      setWorking(null);
    }
  }

  async function exportDiagnostics() {
    setWorking("diagnostics");
    setMessage(null);
    try {
      const response = await fetch("/api/support/diagnostics", { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Unable to generate diagnostics. Check logs or try again.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mixarr-support-diagnostics-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Diagnostics exported.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to generate diagnostics. Check logs or try again.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <div className={styles.cardGrid}>
        <article className={styles.card}>
          <h3>Discord Support</h3>
          <p>Join the Mixarr beta Discord to report bugs, ask questions, and follow development updates.</p>
          {summary.links.discordConfigured && summary.links.discordSupportUrl ? (
            <a className={styles.primaryButton} href={summary.links.discordSupportUrl} target="_blank" rel="noopener noreferrer">Open Discord</a>
          ) : (
            <button className={styles.secondaryButton} type="button" disabled>Discord support link is not configured yet.</button>
          )}
        </article>
        <article className={styles.card}>
          <h3>Copy Bug Report Template</h3>
          <p>Copy a clean template with app version and safe environment details.</p>
          <button className={styles.primaryButton} type="button" disabled={working === "bug"} onClick={() => void copyFrom(templateUrl, "bug")}>
            <Clipboard size={15} /> Copy Bug Report
          </button>
        </article>
        <article className={styles.card}>
          <h3>Copy Feedback Template</h3>
          <p>Use a lighter template for non-bug feedback, confusion, and feature ideas.</p>
          <button className={styles.secondaryButton} type="button" disabled={working === "feedback"} onClick={() => void copyFrom(feedbackUrl, "feedback")}>
            <Clipboard size={15} /> Copy Feedback Template
          </button>
        </article>
        <article className={styles.card}>
          <h3>Export Safe Diagnostics</h3>
          <p>Download a JSON report with health, worker, enrichment, and sync summaries. Secrets are excluded.</p>
          <button className={styles.primaryButton} type="button" disabled={working === "diagnostics"} onClick={() => void exportDiagnostics()}>
            <Download size={15} /> Export Diagnostics
          </button>
        </article>
      </div>

      {message && <div className={message.includes("failed") || message.includes("Unable") ? styles.error : styles.message}>{message}</div>}
      {manualText && (
        <textarea className={styles.fallbackText} readOnly value={manualText} onFocus={(event) => event.currentTarget.select()} />
      )}
    </>
  );
}
