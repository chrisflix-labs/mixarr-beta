import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getExternalApiSettingsPayload } from "@/lib/externalApiSettings";
import { sanitizeErrorText } from "@/lib/supportRedaction";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await getExternalApiSettingsPayload());
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorText(error) || "Unable to load external API settings." }, { status: 500 });
  }
}
