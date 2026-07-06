"use client";

import styles from "./Sidebar.module.css";
import { AudioWaveform, BookMarked, ExternalLink, FlaskConical, Github, HeartPulse, History, LayoutDashboard, ListMusic, ListRestart, Map, ScrollText, Settings, Sparkles, Tags, Wand2 } from "lucide-react";
import PlexLoginButton from "./PlexLoginButton";
import LogoutButton from "./LogoutButton";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MIXARR_GITHUB_URL } from "@/lib/appInfo";

export default function Sidebar({ user, appVersion }: { user: any; appVersion: string }) {
  const pathname = usePathname();

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
      <span className={styles.mobileVersionBadge} aria-label={`Beta Mixarr version ${appVersion}`} title="Beta build">
        <FlaskConical size={12} />
        Beta {appVersion}
      </span>
      <a
        href={MIXARR_GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Mixarr GitHub repository"
        className={styles.mobileGithubLink}
      >
        <Github size={12} />
        <span>GitHub</span>
        <ExternalLink size={10} aria-hidden="true" />
      </a>

      <nav className={styles.nav}>
        <Link href="/" className={`${styles.navItem} ${pathname === "/" ? styles.active : ""}`}>
          <LayoutDashboard size={18} /> Dashboard
        </Link>
        <Link href="/builder" className={`${styles.navItem} ${pathname === "/builder" ? styles.active : ""}`}>
          <Wand2 size={18} /> Build Playlist
        </Link>
        <Link href="/smart-builder" className={`${styles.navItem} ${pathname === "/smart-builder" ? styles.active : ""}`}>
          <Sparkles size={18} /> Smart Builder
        </Link>
        <Link href="/recipes" className={`${styles.navItem} ${pathname.startsWith("/recipes") ? styles.active : ""}`}>
          <BookMarked size={18} /> Recipes
        </Link>
        <Link href="/generated-playlists" className={`${styles.navItem} ${pathname.startsWith("/generated-playlists") ? styles.active : ""}`}>
          <ListRestart size={18} /> Generated Playlists
        </Link>
        <Link href="/playlist-history" className={`${styles.navItem} ${pathname.startsWith("/playlist-history") ? styles.active : ""}`}>
          <History size={18} /> Playlist History
        </Link>
        <Link href="/library" className={`${styles.navItem} ${pathname === "/library" ? styles.active : ""}`}>
          <ListMusic size={18} /> Library
        </Link>
        <Link href="/genres" className={`${styles.navItem} ${pathname.startsWith("/genres") ? styles.active : ""}`}>
          <Tags size={18} /> Genres
        </Link>
        <Link href="/jobs" className={`${styles.navItem} ${pathname.startsWith("/jobs") ? styles.active : ""}`}>
          <History size={18} /> Job History
        </Link>
        <Link href="/library-health" className={`${styles.navItem} ${pathname.startsWith("/library-health") ? styles.active : ""}`}>
          <HeartPulse size={18} /> Library Health
        </Link>
        <Link href="/release-notes" className={`${styles.navItem} ${pathname.startsWith("/release-notes") ? styles.active : ""}`}>
          <ScrollText size={18} /> Release Notes
        </Link>
        <Link href="/roadmap" className={`${styles.navItem} ${pathname.startsWith("/roadmap") ? styles.active : ""}`}>
          <Map size={18} /> Roadmap
        </Link>
        <Link href="/settings" className={`${styles.navItem} ${pathname.startsWith("/settings") ? styles.active : ""}`}>
          <Settings size={18} /> Settings
        </Link>
      </nav>

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
