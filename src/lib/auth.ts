import prisma from "./prisma";

function configuredAdminIdentifiers() {
  return new Set((process.env.MIXARR_ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
}

export async function isUserAdmin(userId: string | null | undefined) {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, plexId: true, username: true, email: true, isAdmin: true } });
  if (!user) return false;
  if (user.isAdmin) return true;
  const configured = configuredAdminIdentifiers();
  return configured.has(user.id) || configured.has(String(user.plexId)) || configured.has(user.username) || (!!user.email && configured.has(user.email));
}

export async function requireAdminUser(userId: string | null | undefined) {
  if (!userId) throw new Error("UNAUTHORIZED");
  if (!(await isUserAdmin(userId))) throw new Error("ADMIN_REQUIRED");
  return userId;
}
