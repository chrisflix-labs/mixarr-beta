import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { exportMetadataSuggestions } from "@/lib/aiAdvisory/service";
export async function POST(request: Request) { try { const result = await exportMetadataSuggestions(advisoryUserId(), await request.json()); return new Response(result.content, { headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store" } }); } catch (error) { return advisoryRouteError(error); } }

