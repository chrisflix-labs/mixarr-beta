import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ status: "healthy", live: true, checkedAt: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()) }); }
