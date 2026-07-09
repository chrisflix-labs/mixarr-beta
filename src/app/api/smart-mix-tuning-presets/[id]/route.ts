import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSmartMixTuningPreset } from "@/lib/smartMixTuningPresets";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteSmartMixTuningPreset(userId, params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Tuning preset not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete tuning preset" }, { status: 500 });
  }
}
