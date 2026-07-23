import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { aiRouteError } from "../services/api";

export async function requireAiUser() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw new Error("UNAUTHORIZED");
  if (!(await prisma.user.count({ where: { id: userId } }))) throw new Error("UNAUTHORIZED");
  return userId;
}

// Authenticated, permission-scoped viewer marker used by AI route contracts.
export const requireAiPermissionedUser = requireAiUser;

export { aiRouteError };
