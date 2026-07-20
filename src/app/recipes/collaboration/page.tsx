import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Home, ShieldAlert, Users } from "lucide-react";
import prisma from "@/lib/prisma";
import styles from "../recipe-tools.module.css";

export const dynamic = "force-dynamic";

export default async function RecipeCollaborationPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return <main className={styles.state}>Sign in to view household recipe collaboration.</main>;
  const memberships = await prisma.householdMember.findMany({ where: { userId }, select: { householdId: true } });
  const householdIds = memberships.map((item) => item.householdId);
  const [households, playlists, pending, conflicts] = await Promise.all([
    prisma.household.findMany({ where: { id: { in: householdIds } }, select: { id: true, name: true, _count: { select: { members: true, guests: true, playlistConfigurations: true } } } }),
    prisma.generatedPlaylist.findMany({ where: { userId, recipeId: { not: null }, householdConfiguration: { isNot: null } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, plexPlaylistTitle: true, recipeId: true, recipeName: true, updatedAt: true, householdConfiguration: { select: { publicationStatus: true, approvalMode: true, household: { select: { id: true, name: true } }, participants: { where: { isActive: true }, select: { id: true } } } } } }),
    prisma.householdPlaylistConfiguration.count({ where: { householdId: { in: householdIds }, publicationStatus: { not: "PUBLISHED" } } }),
    prisma.preferenceConflict.count({ where: { householdId: { in: householdIds }, affectedSelection: true } }),
  ]);
  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/recipes"><ArrowLeft size={15} />Recipe Library</Link><span><Users size={15} />Household collaboration</span><h1>Recipe collaboration dashboard</h1><p>Household recipe usage and approvals reuse the existing household roles and playlist permission model.</p></div><Link className={styles.primary} href="/households">Manage households</Link></header>
    <section className={styles.summaryGrid}><Link href="/households"><span>Households</span><strong>{households.length}</strong></Link><Link href="/generated-playlists"><span>Shared recipe playlists</span><strong>{playlists.length}</strong></Link><Link href="/households"><span>Pending approvals</span><strong>{pending}</strong></Link><Link href="/households"><span>Preference conflicts</span><strong>{conflicts}</strong></Link></section>
    <section className={styles.analyticsGrid}><article><h2><Home />Households</h2>{households.map((household) => <Link className={styles.analyticsRow} href="/households" key={household.id}><span><strong>{household.name}</strong><small>{household._count.members} members · {household._count.guests} guests · {household._count.playlistConfigurations} playlists</small></span></Link>)}</article><article><h2><Users />Recipes used together</h2>{playlists.length ? playlists.map((playlist) => <Link className={styles.analyticsRow} href={`/recipes/${playlist.recipeId}`} key={playlist.id}><span><strong>{playlist.recipeName || "Recipe"}</strong><small>{playlist.plexPlaylistTitle} · {playlist.householdConfiguration?.household.name} · {playlist.householdConfiguration?.participants.length} participants</small></span><b>{playlist.householdConfiguration?.publicationStatus}</b></Link>) : <p>No household playlist currently uses a recipe.</p>}</article></section>
    <div className={styles.notice}><ShieldAlert /><span>Viewing a recipe does not grant edit, approval, export, or activation rights. Those actions remain controlled by the household and recipe governance services.</span></div>
  </main>;
}
