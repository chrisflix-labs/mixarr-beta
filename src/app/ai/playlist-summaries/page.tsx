import type { Metadata } from "next";
import PlaylistSummaryOverview from "@/components/PlaylistSummaryOverview";
export const metadata: Metadata = { title: "Playlist Summaries | Mixarr", description: "Generate privacy-scoped AI playlist summaries and review history." };
export default function PlaylistSummariesPage(){return <PlaylistSummaryOverview/>;}

