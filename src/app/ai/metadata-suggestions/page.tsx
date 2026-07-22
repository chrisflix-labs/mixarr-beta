import type { Metadata } from "next";
import AiMetadataSuggestions from "@/components/AiMetadataSuggestions";
export const metadata: Metadata = { title: "Metadata Suggestions | Mixarr", description: "Review advisory AI-assisted metadata cleanup suggestions without applying metadata changes." };
export default function MetadataSuggestionsPage() { return <AiMetadataSuggestions />; }

