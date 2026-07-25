import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isPathInside, resolveStoragePaths } from "@/lib/storage";

export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

export async function GET(_request: Request, context: { params: { path: string[] } }) {
  if (!cookies().get("mixarr_session")?.value) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const root = resolveStoragePaths().artwork;
  const candidate = path.resolve(root, ...context.params.path.map((part) => path.basename(part)));
  if (!isPathInside(root, candidate) || candidate === path.resolve(root)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await readFile(candidate);
    return new NextResponse(body, { headers: { "Content-Type": contentTypes[path.extname(candidate).toLowerCase()] || "application/octet-stream", "Content-Length": String(body.length), "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
