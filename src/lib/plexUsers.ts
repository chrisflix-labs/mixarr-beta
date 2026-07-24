export type NormalizedPlexUser = {
  id: string;
  username: string;
  email: string | null;
  title: string;
  avatarUrl: string | null;
  isOwner: boolean;
  isManaged: boolean;
  isHomeUser: boolean;
  accountType: "OWNER" | "MANAGED" | "HOME" | "SHARED";
};

export type PlexOwnerIdentity = {
  id: string | number;
  username: string;
  email?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
};

function text(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function stableId(record: Record<string, unknown>) {
  const direct = text(record.id ?? record.accountID ?? record.accountId ?? record.userID ?? record.userId);
  if (direct) return direct;
  const key = text(record.key);
  return key ? key.split("/").filter(Boolean).at(-1) || "" : "";
}

function normalizeRecord(record: Record<string, unknown>, ownerId?: string): NormalizedPlexUser | null {
  const id = stableId(record);
  const username = text(record.username ?? record.name ?? record.title ?? record.friendlyName ?? record.email);
  if (!id || !username) return null;
  const rawType = text(record.accountType ?? record.type).toLowerCase();
  const isOwner = truthy(record.isOwner ?? record.owner) || (!!ownerId && id === ownerId);
  const isManaged = !isOwner && (
    truthy(record.isManaged ?? record.managed)
    || rawType === "managed"
    || rawType === "managed_user"
  );
  const isHomeUser = isOwner || isManaged || truthy(record.isHomeUser ?? record.home) || rawType === "home";
  const accountType = isOwner ? "OWNER" : isManaged ? "MANAGED" : isHomeUser ? "HOME" : "SHARED";
  return {
    id,
    username,
    email: text(record.email) || null,
    title: text(record.title ?? record.friendlyName) || username,
    avatarUrl: text(record.avatarUrl ?? record.thumb ?? record.avatar) || null,
    isOwner,
    isManaged,
    isHomeUser,
    accountType,
  };
}

function mergeUser(existing: NormalizedPlexUser, next: NormalizedPlexUser): NormalizedPlexUser {
  const isOwner = existing.isOwner || next.isOwner;
  const isManaged = !isOwner && (existing.isManaged || next.isManaged);
  const isHomeUser = isOwner || isManaged || existing.isHomeUser || next.isHomeUser;
  return {
    id: existing.id,
    username: next.username || existing.username,
    email: next.email || existing.email,
    title: next.title || existing.title,
    avatarUrl: next.avatarUrl || existing.avatarUrl,
    isOwner,
    isManaged,
    isHomeUser,
    accountType: isOwner ? "OWNER" : isManaged ? "MANAGED" : isHomeUser ? "HOME" : "SHARED",
  };
}

export function normalizePlexUsers(records: unknown[], owner?: PlexOwnerIdentity | null) {
  const ownerId = owner ? text(owner.id) : "";
  const candidates: Record<string, unknown>[] = [];
  if (owner && ownerId && text(owner.username)) {
    candidates.push({
      id: ownerId,
      username: owner.username,
      email: owner.email,
      title: owner.title,
      avatarUrl: owner.avatarUrl,
      isOwner: true,
      isHomeUser: true,
    });
  }
  candidates.push(...records.filter((record): record is Record<string, unknown> => !!record && typeof record === "object" && !Array.isArray(record)));

  const users = new Map<string, NormalizedPlexUser>();
  let malformedRecordsSkipped = records.length - candidates.length + (owner ? 1 : 0);
  for (const candidate of candidates) {
    const normalized = normalizeRecord(candidate, ownerId);
    if (!normalized) {
      malformedRecordsSkipped += 1;
      continue;
    }
    const existing = users.get(normalized.id);
    users.set(normalized.id, existing ? mergeUser(existing, normalized) : normalized);
  }
  return {
    users: Array.from(users.values()).sort((left, right) => (
      Number(right.isOwner) - Number(left.isOwner)
      || Number(right.isHomeUser) - Number(left.isHomeUser)
      || left.title.localeCompare(right.title)
    )),
    malformedRecordsSkipped,
  };
}

export function formatPlexAccountLabel(user: Pick<NormalizedPlexUser, "id" | "username" | "email" | "title" | "isOwner" | "isManaged">) {
  const parts = [user.title || user.username || `Plex user ${user.id}`];
  if (user.email && user.email.toLowerCase() !== parts[0].toLowerCase()) parts.push(user.email);
  if (user.isOwner) parts.push("Owner");
  else if (user.isManaged) parts.push("Managed user");
  return parts.join(" — ");
}

export type PlexDiscoveryFailure = {
  code: "PLEX_AUTH_REJECTED" | "PLEX_TIMEOUT" | "PLEX_UNREACHABLE" | "PLEX_DISCOVERY_FAILED";
  status: number;
  message: string;
};

export function classifyPlexDiscoveryFailure(error: unknown): PlexDiscoveryFailure {
  const value = error as { httpStatus?: number; status?: number; code?: string; name?: string; message?: string };
  const httpStatus = Number(value?.httpStatus ?? value?.status ?? 0);
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 498) {
    return { code: "PLEX_AUTH_REJECTED", status: 502, message: "Plex rejected the configured authentication token." };
  }
  if (value?.name === "AbortError" || value?.code === "ETIMEDOUT" || /timed?\s*out|timeout/i.test(value?.message || "")) {
    return { code: "PLEX_TIMEOUT", status: 504, message: "The Plex server did not respond before the discovery timeout." };
  }
  if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(value?.code || "") || error instanceof TypeError) {
    return { code: "PLEX_UNREACHABLE", status: 503, message: "The configured Plex server could not be reached." };
  }
  return { code: "PLEX_DISCOVERY_FAILED", status: 502, message: "Plex account discovery failed." };
}
