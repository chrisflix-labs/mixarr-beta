import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, DatabaseBackup, ShieldAlert } from "lucide-react";
import { isUserAdmin } from "@/lib/auth";
import { getLibraryBackupCoverage } from "@/lib/libraryBackup/backupCoverage";
import { BACKUP_SCOPE_SUMMARY } from "@/lib/libraryBackup/scopeDescription";
import LibraryBackupManager from "@/components/LibraryBackupManager";
import styles from "./library-backup.module.css";

export const dynamic = "force-dynamic";

export default async function LibraryBackupPage() {
  const userId = cookies().get("mixarr_session")?.value;
  const admin = userId ? await isUserAdmin(userId).catch(() => false) : false;

  if (!admin) {
    return (
      <div className={styles.wrapper}>
        <header className={styles.header}>
          <h2><DatabaseBackup size={26} color="var(--accent)" /> Library Intelligence Backup</h2>
        </header>
        <div className={`glass-panel ${styles.deniedPanel}`} role="alert">
          <ShieldAlert size={22} color="var(--warning)" />
          <p>Library Intelligence Backup &amp; Restore is restricted to administrators.</p>
        </div>
      </div>
    );
  }

  const coverage = await getLibraryBackupCoverage(userId as string).catch(() => null);

  return (
    <div className={styles.wrapper}>
      <Link href="/settings" className={styles.backLink}><ArrowLeft size={16} /> Back to Settings</Link>
      <header className={styles.header}>
        <h2><DatabaseBackup size={26} color="var(--accent)" /> Library Intelligence Backup &amp; Restore</h2>
        <p>{BACKUP_SCOPE_SUMMARY}</p>
      </header>
      <LibraryBackupManager initialCoverage={coverage} />
    </div>
  );
}
