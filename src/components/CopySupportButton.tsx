"use client";

import { useState } from "react";
import { tryCopyTextToClipboard } from "@/lib/clipboard";

export default function CopySupportButton({
  url,
  label,
  className,
}: {
  url: string;
  label: string;
  className?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function copy() {
    setWorking(true);
    setMessage(null);
    setFallback(null);
    let text: string | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Copy failed. Select and copy manually.");
      }
      text = await response.text();
      const result = await tryCopyTextToClipboard(text);
      if (!result.ok) {
        setFallback(text);
        setMessage(result.reason === "not-secure-context" ? "Automatic clipboard access is unavailable here. Select and copy manually." : "Automatic copying was blocked. Select and copy manually.");
        return;
      }
      setMessage("Copied to clipboard.");
    } catch (error) {
      if (text) setFallback(text);
      setMessage(error instanceof Error ? error.message : "Copy failed. Select and copy manually.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <button className={className} type="button" disabled={working} onClick={() => void copy()}>
        {label}
      </button>
      {message && <small aria-live="polite">{message}</small>}
      {fallback && <textarea readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} />}
    </>
  );
}
