import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { deleteNaturalLanguageRequest, getNaturalLanguageRequest, updateNaturalLanguageDraft } from "@/lib/naturalLanguageRequests/service";

export async function GET(_request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json({ request: await getNaturalLanguageRequest(naturalLanguageUserId(), params.id) }); } catch (error) { return naturalLanguageApiError(error); } }
export async function PATCH(request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json({ request: await updateNaturalLanguageDraft(naturalLanguageUserId(), params.id, await request.json()) }); } catch (error) { return naturalLanguageApiError(error); } }
export async function DELETE(_request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json(await deleteNaturalLanguageRequest(naturalLanguageUserId(), params.id)); } catch (error) { return naturalLanguageApiError(error); } }
