import RecipeStudio from "@/components/RecipeStudio";

export const metadata = { title: "Edit Recipe | Mixarr", description: "Edit and analyze a reusable Smart Mix recipe." };
export default function EditRecipePage({ params }: { params: { id: string } }) { return <RecipeStudio recipeId={params.id} />; }
