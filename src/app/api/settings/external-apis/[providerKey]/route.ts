import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getExternalApiSettingsPayload,
  removeExternalApiProviderCredentials,
  saveExternalApiProviderSetting,
} from "@/lib/externalApiSettings";
import { sanitizeErrorText } from "@/lib/supportRedaction";

export async function POST(req: Request, { params }: { params: { providerKey: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    await saveExternalApiProviderSetting(params.providerKey, body);
    return NextResponse.json(await getExternalApiSettingsPayload());
  } catch (error) {
    const message = sanitizeErrorText(error) || "Unable to save provider settings.";
    const status = message.includes("Secret encryption key is not configured") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: { providerKey: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await removeExternalApiProviderCredentials(params.providerKey);
    return NextResponse.json(await getExternalApiSettingsPayload());
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorText(error) || "Unable to remove provider credentials." }, { status: 500 });
  }
}
