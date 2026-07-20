import RecipeStudio from "@/components/RecipeStudio";
export const metadata = { title: "Edit Request Recipe | Mixarr", description: "Edit a natural-language request using canonical Recipe Studio controls." };
export default function EditRequestRecipePage({ params }: { params: { id: string } }) { return <RecipeStudio naturalLanguageRequestId={params.id}/>; }
