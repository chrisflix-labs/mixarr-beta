import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { metadataCorrectionErrorResponse, setMetadataVerification } from "@/lib/metadataCorrectionService";

async function mutate(request: Request, params: { id: string }, verified: boolean) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await setMetadataVerification({ userId, trackId: params.id, field: body.field, source: body.source, verified, note: body.note }));
  } catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) { return mutate(request, params, true); }
export async function DELETE(request: Request, { params }: { params: { id: string } }) { return mutate(request, params, false); }
