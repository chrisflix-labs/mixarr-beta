import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { metadataCorrectionErrorResponse, setMetadataSourceIgnored } from "@/lib/metadataCorrectionService";

async function mutate(request: Request, params: { id: string }, ignored: boolean) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await setMetadataSourceIgnored({ userId, trackId: params.id, field: body.field, source: body.source, ignored, reason: body.reason }));
  } catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) { return mutate(request, params, true); }
export async function DELETE(request: Request, { params }: { params: { id: string } }) { return mutate(request, params, false); }
