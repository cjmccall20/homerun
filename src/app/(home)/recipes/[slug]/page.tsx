import { notFound } from "next/navigation";

import { DraftReview } from "@/components/DraftReview";
import { RecipeDetail } from "@/components/RecipeDetail";
import { currentWho } from "@/lib/session";
import { listRecipes, readRecipe } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function RecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [recipe, who, all] = await Promise.all([
    readRecipe(decodeURIComponent(slug)),
    currentWho(),
    listRecipes("all"),
  ]);
  if (!recipe) notFound();

  // A draft is not a recipe yet, so it does not get the recipe page. It gets
  // the review screen, which is the only place it can become one.
  if (recipe.status === "draft") return <DraftReview recipe={recipe} />;

  // Every tag already in use, so the editor can suggest one rather than let
  // somebody invent a second spelling of a filter that already exists.
  const vocabulary = [...new Set(all.flatMap((r) => r.tags))].sort();
  return <RecipeDetail recipe={recipe} me={who} vocabulary={vocabulary} />;
}
