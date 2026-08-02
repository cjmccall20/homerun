import { notFound } from "next/navigation";

import { RecipeForm } from "@/components/RecipeForm";
import { readRecipe } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await readRecipe(decodeURIComponent(slug));
  if (!recipe) notFound();
  return <RecipeForm recipe={recipe} />;
}
