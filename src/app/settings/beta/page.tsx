import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import BetaAdministration from "@/components/BetaAdministration";
import { isUserAdmin } from "@/lib/auth";
import styles from "../settings.module.css";

export default async function BetaAdministrationPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId || !(await isUserAdmin(userId))) redirect("/settings");
  return <div className={styles.wrapper}>
    <header className={styles.header}><h2><FlaskConical size={28} color="var(--warning)" /> Beta Administration</h2><p>Manage server-eligible experiments, private access, emergency overrides, usage, and diagnostics.</p></header>
    <section className={`glass-panel ${styles.section} ${styles.betaSection}`}><BetaAdministration /></section>
    <Link className={styles.secondaryButton} href="/settings">Back to Settings</Link>
  </div>;
}
