import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { createAiProvider, duplicateAiProvider, listAiProviders } from "@/ai/services/providerService";
import { aiProviderRegistry } from "@/ai/registry/providerRegistry";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiPermission("ai.provider.view"); return NextResponse.json({ providers: await listAiProviders(), providerTypes: aiProviderRegistry.list() }); } catch (error) { return aiRouteError(error); } }
export async function POST(request: Request) { try { await requireAiPermission("ai.provider.manage"); const body = await request.json(); return NextResponse.json(body.duplicateProviderId ? await duplicateAiProvider(body.duplicateProviderId) : await createAiProvider(body), { status: 201 }); } catch (error) { return aiRouteError(error); } }
