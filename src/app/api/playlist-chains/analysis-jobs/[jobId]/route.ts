import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { cancelChainAnalysis, getChainAnalysisJob } from "@/lib/playlistChains";
export async function GET(_: Request, { params }: { params: { jobId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const job = await getChainAnalysisJob(userId, params.jobId); return job ? NextResponse.json(job) : chainApiError(new Error("Chain analysis job not found.")); } catch (error) { return chainApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { jobId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const job = await cancelChainAnalysis(userId, params.jobId); return job ? NextResponse.json(job) : chainApiError(new Error("Chain analysis job not found.")); } catch (error) { return chainApiError(error); } }

