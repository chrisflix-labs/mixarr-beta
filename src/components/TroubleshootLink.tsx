import Link from "next/link";
import { Wrench } from "lucide-react";
import styles from "./TroubleshootLink.module.css";

export default function TroubleshootLink({ resourceType, resourceId, category, label = "Troubleshoot", compact = false }: { resourceType: string; resourceId: string; category: string; label?: string; compact?: boolean }) {
  const query = new URLSearchParams({ resourceType, resourceId, category });
  return <Link className={`${styles.link} ${compact ? styles.compact : ""}`} href={`/troubleshooting?${query.toString()}`}><Wrench size={compact ? 13 : 15} /> {label}</Link>;
}
