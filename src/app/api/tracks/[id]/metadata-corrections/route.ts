import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTrackMetadataCorrectionDetails, metadataCorrectionErrorResponse, setTrackMetadataCorrection } from "@/lib/metadataCorrectionService";

export const dynamic = "force-dynamic";

function userId() { return cookies().get("mixarr_session")?.value; }

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = userId();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json(await getTrackMetadataCorrectionDetails(user, params.id)); }
  catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = userId();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await setTrackMetadataCorrection({ userId: user, trackId: params.id, field: body.field, value: body.value, reason: body.reason, verified: body.verified }), { status: 201 });
  } catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}
