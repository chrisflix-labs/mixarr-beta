import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { deleteAiProvider, getAiProvider, updateAiProvider } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); return NextResponse.json(await getAiProvider(params.providerId)); } catch (error) { return aiRouteError(error); } }
export async function PATCH(request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); return NextResponse.json(await updateAiProvider(params.providerId, await request.json())); } catch (error) { return aiRouteError(error); } }
export async function DELETE(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); await deleteAiProvider(params.providerId); return new NextResponse(null, { status: 204 }); } catch (error) { return aiRouteError(error); } }
