"use client";

export type PlaylistGenerationJobView = {
  id?: string;
  jobId?: string;
  status: string;
  summary?: string | null;
  error?: string | null;
  progress?: {
    stage?: string;
    stageLabel?: string;
    requestedTracks?: number;
    initialCandidates?: number;
    eligibleCandidates?: number;
    processedCandidates?: number;
    selectedTracks?: number;
    elapsedMs?: number;
    heapUsedMb?: number;
    databaseQueries?: number;
  } | null;
  result?: any;
  limits?: Record<string, number>;
  largeRequest?: boolean;
};

export async function generatePlaylistPreviewInBackground(payload: unknown, onUpdate: (job: PlaylistGenerationJobView) => void) {
  const response = await fetch("/api/playlists/generation-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const queued = await response.json();
  if (!response.ok) throw new Error(queued.error || "Unable to start playlist generation.");
  onUpdate({ ...queued, id: queued.jobId });

  return new Promise<any>((resolve, reject) => {
    const events = new EventSource(`/api/playlists/generation-jobs/${queued.jobId}/events`);
    let settled = false;
    const finish = (handler: () => void) => { if (settled) return; settled = true; events.close(); handler(); };
    events.addEventListener("progress", (event) => {
      const job = JSON.parse((event as MessageEvent).data) as PlaylistGenerationJobView;
      onUpdate(job);
      if (["completed", "completed_with_warnings"].includes(job.status)) finish(() => resolve(job.result));
      else if (["failed", "cancelled", "interrupted", "stale"].includes(job.status)) finish(() => reject(new Error(job.summary || job.error || `Generation ${job.status}.`)));
    });
    events.onerror = () => finish(() => reject(new Error("Live generation updates were interrupted. Open Job History to inspect the result.")));
  });
}

export async function cancelPlaylistGeneration(jobId: string) {
  const response = await fetch(`/api/playlists/generation-jobs/${jobId}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to cancel generation.");
  return data;
}
