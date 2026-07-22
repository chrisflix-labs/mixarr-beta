import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { deleteIgnoreRule, updateIgnoreRule } from "@/lib/aiAdvisory/service";
export async function PATCH(request: Request, { params }: { params: { ruleId: string } }) { try { return NextResponse.json({ rule: await updateIgnoreRule(advisoryUserId(), params.ruleId, await request.json()) }); } catch (error) { return advisoryRouteError(error); } }
export async function DELETE(_request: Request, { params }: { params: { ruleId: string } }) { try { return NextResponse.json(await deleteIgnoreRule(advisoryUserId(), params.ruleId)); } catch (error) { return advisoryRouteError(error); } }

