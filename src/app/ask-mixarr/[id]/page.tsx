import { NaturalLanguageRequestReview } from "@/components/NaturalLanguageRequests";
export const metadata = { title: "Request Review | Mixarr", description: "Review assumptions, recipe analysis, and deterministic preview before approval." };
export default function RequestReviewPage({ params }: { params: { id: string } }) { return <NaturalLanguageRequestReview requestId={params.id}/>; }
