import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listSmartMixTuningPresets, saveSmartMixTuningPreset } from "@/lib/smartMixTuningPresets";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await listSmartMixTuningPresets(userId));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load tuning presets" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const preset = await saveSmartMixTuningPreset({
      userId,
      name: typeof body.name === "string" ? body.name : "",
      config: body.tuningConfig || body.config || {},
    });

    return NextResponse.json({ preset }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save tuning preset" }, { status: 400 });
  }
}
