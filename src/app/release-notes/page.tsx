import styles from "./release-notes.module.css";
import { CalendarDays, MessageCircle, ScrollText } from "lucide-react";
import { getReleaseNotesNewestFirst, MIXARR_BETA_DISCORD_URL } from "@/lib/releaseNotes";

export const metadata = {
  title: "Release Notes | Mixarr",
  description: "Mixarr changelog and release notes",
};

export default function ReleaseNotesPage() {
  const notes = getReleaseNotesNewestFirst();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <ScrollText size={14} />
            Changelog
          </span>
          <h2>Release Notes</h2>
          <p>Read Mixarr changes from newest to oldest.</p>
        </div>
      </header>

      <section className={styles.betaNotice} aria-label="Beta release notes notice">
        <div className={styles.noticeIcon}>
          <MessageCircle size={18} />
        </div>
        <div>
          <h3>Beta features are still being tested</h3>
          <p>
            Mixarr is actively developed, and some features listed here are beta or experimental. If you run into bugs,
            missing metadata, retry issues, or unexpected results, please report them in the Mixarr beta Discord.
          </p>
          <a href={MIXARR_BETA_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            {MIXARR_BETA_DISCORD_URL}
          </a>
        </div>
      </section>

      {notes.length === 0 ? (
        <div className={styles.emptyState}>No release notes have been added yet.</div>
      ) : (
        <section className={styles.timeline} aria-label="Mixarr release history">
          {notes.map((note) => (
            <article key={note.version} className={styles.releaseCard}>
              <div className={styles.versionRail} aria-hidden="true">
                <span />
              </div>
              <div className={styles.releaseContent}>
                <div className={styles.releaseHeader}>
                  <div>
                    <span className={styles.version}>v{note.version}</span>
                    <h3>{note.title}</h3>
                  </div>
                  <div className={styles.datePill}>
                    <CalendarDays size={14} />
                    {note.releaseDate || "Date unavailable"}
                  </div>
                </div>

                <div className={styles.badges} aria-label={`Release tags for version ${note.version}`}>
                  {note.badges.map((badge) => (
                    <span key={badge}>{badge}</span>
                  ))}
                </div>

                <ul className={styles.changes}>
                  {note.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
