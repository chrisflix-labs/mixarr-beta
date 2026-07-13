import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { metadataCorrectionErrorResponse, removeTrackMetadataCorrection, setTrackMetadataCorrection } from "@/lib/metadataCorrectionService";

function userId() { return cookies().get("mixarr_session")?.value; }

export async function PATCH(request: Request, { params }: { params: { id: string; field: string } }) {
  const user = userId();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await setTrackMetadataCorrection({ userId: user, trackId: params.id, field: params.field, value: body.value, reason: body.reason, verified: body.verified }));
  } catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}

export async function DELETE(request: Request, { params }: { params: { id: string; field: string } }) {
  const user = userId();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await removeTrackMetadataCorrection(user, params.id, params.field, body.reason));
  } catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}
