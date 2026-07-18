"use client";

import styles from "./Sidebar.module.css";
import { useEffect, useMemo, useState } from "react";
import { AudioWaveform, BarChart3, BookMarked, Brain, ChevronDown, ExternalLink, FlaskConical, Github, Grid2X2, HeartPulse, History, LayoutDashboard, LifeBuoy, ListChecks, ListMusic, ListRestart, Map, MoreHorizontal, Network, Route, ScrollText, Settings, ShieldCheck, Sparkles, Tags, Wand2, X } from "lucide-react";
import PlexLoginButton from "./PlexLoginButton";
import LogoutButton from "./LogoutButton";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MIXARR_GITHUB_URL } from "@/lib/appInfo";

const playlistLinks = [
  { href: "/builder", label: "Build Playlist", shortLabel: "Build", icon: Wand2, isActive: (pathname: string) => pathname === "/builder" },
  { href: "/smart-builder", label: "Smart Builder", shortLabel: "Smart", icon: Sparkles, isActive: (pathname: string) => pathname === "/smart-builder" },
  { href: "/smart-actions", label: "Smart Actions", shortLabel: "Actions", icon: ListChecks, isActive: (pathname: string) => pathname.startsWith("/smart-actions") },
  { href: "/experiments", label: "Smart Experiments", shortLabel: "Tests", icon: FlaskConical, isActive: (pathname: string) => pathname.startsWith("/experiments") },
  { href: "/recipes", label: "Recipes", shortLabel: "Recipes", icon: BookMarked, isActive: (pathname: string) => pathname.startsWith("/recipes") },
  { href: "/generated-playlists", label: "Generated Playlists", icon: ListRestart, isActive: (pathname: string) => pathname.startsWith("/generated-playlists") },
  { href: "/playlist-groups", label: "Collections", icon: Grid2X2, isActive: (pathname: string) => pathname.startsWith("/playlist-groups") },
  { href: "/playlist-chains", label: "Playlist Chains", icon: Route, isActive: (pathname: string) => pathname.startsWith("/playlist-chains") },
  { href: "/playlist-coordination", label: "Cross-Playlist Variety", icon: Network, isActive: (pathname: string) => pathname.startsWith("/playlist-coordination") },
  { href: "/orchestration", label: "Playlist Orchestration", icon: Network, isActive: (pathname: string) => pathname.startsWith("/orchestration") },
  { href: "/recently-added", label: "Recently Added", icon: Sparkles, isActive: (pathname: string) => pathname.startsWith("/recently-added") },
  { href: "/automation", label: "Automation Policies", icon: ShieldCheck, isActive: (pathname: string) => pathname.startsWith("/automation") },
  { href: "/playlist-history", label: "Playlist History", icon: History, isActive: (pathname: string) => pathname.startsWith("/playlist-history") },
];

const libraryLinks = [
  { href: "/library", label: "Tracks", icon: ListMusic, isActive: (pathname: string) => pathname === "/library" },
  { href: "/library-coverage", label: "Library Coverage", icon: BarChart3, isActive: (pathname: string) => pathname.startsWith("/library-coverage") },
  { href: "/genres", label: "Genres", icon: Tags, isActive: (pathname: string) => pathname.startsWith("/genres") },
  { href: "/data-enrichment", label: "Data Enrichment", icon: AudioWaveform, isActive: (pathname: string) => pathname.startsWith("/data-enrichment") },
  { href: "/library-health", label: "Library Health", icon: HeartPulse, isActive: (pathname: string) => pathname.startsWith("/library-health") },
];

const activityLinks = [
  { href: "/personalization", label: "Personalization", icon: Brain, isActive: (pathname: string) => pathname.startsWith("/personalization") },
  { href: "/job-history", label: "Job History", icon: History, isActive: (pathname: string) => pathname.startsWith("/job-history") || pathname.startsWith("/jobs") },
  { href: "/support", label: "Beta Support", icon: LifeBuoy, isActive: (pathname: string) => pathname.startsWith("/support") },
  { href: "/release-notes", label: "Release Notes", icon: ScrollText, isActive: (pathname: string) => pathname.startsWith("/release-notes") },
  { href: "/roadmap", label: "Roadmap", icon: Map, isActive: (pathname: string) => pathname.startsWith("/roadmap") },
];

const navGroups = [
  { id: "playlists", label: "Playlists", icon: ListMusic, links: playlistLinks },
  { id: "library", label: "Library", icon: ListMusic, links: libraryLinks },
  { id: "activity", label: "Activity", icon: History, links: activityLinks },
];

export default function Sidebar({ user, appVersion }: { user: any; appVersion: string }) {
  const pathname = usePathname();
  const activeGroupIds = useMemo(
    () => navGroups.filter((group) => group.links.some((link) => link.isActive(pathname))).map((group) => group.id),
    [pathname],
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(activeGroupIds.map((id) => [id, true])),
  );
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  useEffect(() => {
    if (activeGroupIds.length === 0) return;
    setOpenGroups((current) => ({
      ...current,
      ...Object.fromEntries(activeGroupIds.map((id) => [id, true])),
    }));
  }, [activeGroupIds]);

  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMoreOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMoreOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMoreOpen]);

  const isMoreActive = !(
    pathname === "/" ||
    pathname === "/builder" ||
    pathname === "/smart-builder" ||
    pathname.startsWith("/recipes")
  );

  function toggleGroup(groupId: string, isActive: boolean) {
    setOpenGroups((current) => ({
      ...current,
      [groupId]: isActive ? true : !current[groupId],
    }));
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoContainer}>
        <div className={styles.logoIcon}>
          <AudioWaveform size={24} />
        </div>
        <div className={styles.logoCopy}>
          <div className={styles.logoTitleRow}>
            <h1 className={styles.logoTitle}>Mixarr</h1>
            <span className={styles.statusBadge} aria-label="Beta Mixarr build" title="Beta build">
              <FlaskConical size={12} />
              Beta
            </span>
          </div>
          <p className={styles.logoSubtitle}>Smart Playlist Engine</p>
          <div className={styles.brandMeta}>
            <span className={styles.versionBadge} aria-label={`Mixarr version ${appVersion}`}>
              {appVersion}
            </span>
            <a
              href={MIXARR_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Mixarr GitHub repository"
              className={styles.githubLink}
            >
              <Github size={13} />
              <span>GitHub</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <nav className={styles.desktopNav} aria-label="Primary navigation">
        <Link href="/" className={`${styles.navItem} ${pathname === "/" ? styles.active : ""}`}>
          <LayoutDashboard size={18} /> Dashboard
        </Link>
        {navGroups.map((group) => {
          const Icon = group.icon;
          const isGroupActive = activeGroupIds.includes(group.id);
          const isOpen = openGroups[group.id] || isGroupActive;
          return (
            <div key={group.id} className={styles.navGroup}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.groupButton} ${isGroupActive ? styles.groupActive : ""}`}
                aria-expanded={isOpen}
                aria-controls={`sidebar-${group.id}`}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label} navigation`}
                onClick={() => toggleGroup(group.id, isGroupActive)}
              >
                <span className={styles.navItemLabel}>
                  <Icon size={18} /> {group.label}
                </span>
                <ChevronDown size={16} className={`${styles.groupChevron} ${isOpen ? styles.groupChevronOpen : ""}`} aria-hidden="true" />
              </button>
              {isOpen && (
                <div id={`sidebar-${group.id}`} className={styles.navChildren}>
                  {group.links.map((link) => {
                    const ChildIcon = link.icon;
                    return (
                      <Link key={link.href} href={link.href} className={`${styles.childNavItem} ${link.isActive(pathname) ? styles.active : ""}`}>
                        <ChildIcon size={16} /> {link.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <Link href="/settings" className={`${styles.navItem} ${pathname.startsWith("/settings") ? styles.active : ""}`}>
          <Settings size={18} /> Settings
        </Link>
      </nav>

      <nav className={styles.mobileNav} aria-label="Mobile primary navigation">
        <Link href="/" className={`${styles.mobileNavItem} ${pathname === "/" ? styles.active : ""}`}>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </Link>
        {playlistLinks.slice(0, 3).map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className={`${styles.mobileNavItem} ${link.isActive(pathname) ? styles.active : ""}`}>
              <Icon size={20} />
              <span>{link.shortLabel || link.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`${styles.mobileNavItem} ${styles.mobileMoreButton} ${isMoreActive || isMoreOpen ? styles.active : ""}`}
          aria-expanded={isMoreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setIsMoreOpen(true)}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>

      {isMoreOpen && (
        <div className={styles.mobileMenuLayer}>
          <button type="button" className={styles.mobileMenuBackdrop} aria-label="Close navigation menu" onClick={() => setIsMoreOpen(false)} />
          <div id="mobile-more-menu" className={styles.mobileMenu} role="dialog" aria-modal="true" aria-label="More navigation">
            <div className={styles.mobileMenuHeader}>
              <div>
                <h2>More</h2>
                <p>Mixarr {appVersion}</p>
              </div>
              <button type="button" className={styles.closeButton} aria-label="Close navigation menu" onClick={() => setIsMoreOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.mobileBrandRow}>
              <span className={styles.mobileMenuBadge} aria-label={`Beta Mixarr version ${appVersion}`} title="Beta build">
                <FlaskConical size={12} />
                Beta {appVersion}
              </span>
              <a href={MIXARR_GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="Open Mixarr GitHub repository" className={styles.mobileMenuGithub}>
                <Github size={12} />
                <span>GitHub</span>
                <ExternalLink size={10} aria-hidden="true" />
              </a>
            </div>

            <div className={styles.mobileMenuSections}>
              <MobileMenuSection title="Playlist Tools" links={playlistLinks.slice(3)} pathname={pathname} />
              <MobileMenuSection title="Library" links={libraryLinks.map((link) => link.href === "/library" ? { ...link, label: "Library" } : link)} pathname={pathname} />
              <MobileMenuSection title="Activity" links={activityLinks} pathname={pathname} />
              <MobileMenuSection title="App" links={[{ href: "/settings", label: "Settings", icon: Settings, isActive: (currentPath: string) => currentPath.startsWith("/settings") }]} pathname={pathname} />
            </div>

            <div className={styles.mobileAuthStatus}>
              {user ? (
                <>
                  <p className={styles.authStatusText}>Connected as</p>
                  <div className={styles.mobileUserRow}>
                    <div className={styles.mobileUserIdentity}>
                      {user.thumb && <img src={user.thumb} alt="Avatar" />}
                      <span>{user.username}</span>
                    </div>
                    <LogoutButton />
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.authStatusText}>Not Connected</p>
                  <PlexLoginButton />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.authStatus}>
        {user ? (
          <>
            <p className={styles.authStatusText}>Connected as</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {user.thumb && <img src={user.thumb} alt="Avatar" style={{ width: 24, height: 24, borderRadius: '50%' }} />}
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{user.username}</span>
              </div>
              <LogoutButton />
            </div>
          </>
        ) : (
          <>
            <p className={styles.authStatusText}>Not Connected</p>
            <PlexLoginButton />
          </>
        )}
      </div>
    </aside>
  );
}

function MobileMenuSection({
  title,
  links,
  pathname,
}: {
  title: string;
  links: Array<{ href: string; label: string; icon: typeof LayoutDashboard; isActive: (pathname: string) => boolean }>;
  pathname: string;
}) {
  return (
    <section className={styles.mobileMenuSection} aria-labelledby={`mobile-menu-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h3 id={`mobile-menu-${title.toLowerCase().replace(/\s+/g, "-")}`}>{title}</h3>
      <div>
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className={`${styles.mobileMenuLink} ${link.isActive(pathname) ? styles.active : ""}`}>
              <Icon size={17} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
