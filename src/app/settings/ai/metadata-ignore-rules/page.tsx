import type { Metadata } from "next";
import AiAdvisorySettings from "@/components/AiAdvisorySettings";
export const metadata:Metadata={title:"AI Advisory Settings | Mixarr",description:"Configure playlist summaries, metadata suggestions, and ignore rules."};
export default function AiAdvisorySettingsPage(){return <AiAdvisorySettings/>;}

