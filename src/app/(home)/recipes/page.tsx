import { RecipeList } from "@/components/RecipeList";
import { currentWho } from "@/lib/session";
import { listRecipes } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const [all, who] = await Promise.all([listRecipes("all"), currentWho()]);
  return (
    <RecipeList
      recipes={all.filter((r) => r.status === "live")}
      drafts={all.filter((r) => r.status === "draft")}
      me={who}
    />
  );
}
