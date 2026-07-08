"use client";

import { useState } from "react";

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
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Copy failed. Select and copy manually.");
      }
      const text = await response.text();
      if (!navigator.clipboard?.writeText) {
        setFallback(text);
        setMessage("Copy failed. Select and copy manually.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setMessage("Copied to clipboard.");
    } catch (error) {
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
