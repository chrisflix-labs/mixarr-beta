import { cookies } from "next/headers";
import { getPlaylistGenerationJob } from "@/lib/playlistGenerationJobs";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const encoder = new TextEncoder();
  const terminal = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "interrupted", "stale"]);
  const stream = new ReadableStream({
    async start(controller) {
      let lastPayload = "";
      try {
        while (!req.signal.aborted) {
          const job = await getPlaylistGenerationJob(userId, params.id);
          if (!job) { controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Generation job not found" })}\n\n`)); break; }
          const payload = JSON.stringify(job);
          if (payload !== lastPayload) { controller.enqueue(encoder.encode(`event: progress\ndata: ${payload}\n\n`)); lastPayload = payload; }
          if (terminal.has(job.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
