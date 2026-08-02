import type { NextRequest } from "next/server";

import { body, handle, num, ok, str, strList } from "@/lib/api";
import { matchesAllTags, normalizeTag } from "@/lib/tag-taxonomy";
import { newRecipeNote } from "@/lib/parse/recipe";
import { listRecipes, recipePath, uniqueRecipeSlug } from "@/lib/store";
import * as vault from "@/lib/vault";

/**
 * The recipe list, optionally narrowed.
 *
 *   /api/recipes                        every live recipe
 *   /api/recipes?tags=dinner,italian    recipes carrying BOTH tags
 *   /api/recipes?include=draft          drafts waiting for review
 *
 * Multiple tags are AND, not OR. "dinner + italian" means italian dinners; a
 * union of everything tagged either would be a longer list than the one you
 * started with, which is the opposite of filtering.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const include = params.get("include");
    const scope =
      include === "draft" || include === "all" ? include : "live";

    const selected = (params.get("tags") ?? "")
      .split(",")
      .map((t) => normalizeTag(t))
      .filter(Boolean);

    const all = await listRecipes(scope);
    const recipes = all.filter((r) => matchesAllTags(r.tags, selected));
    return ok({ recipes, count: recipes.length, tags: selected });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const title = str(payload.title ?? "", "title").trim();
    if (!title) throw new Error("A recipe needs a title.");

    const slug = await uniqueRecipeSlug(title);
    const note = newRecipeNote({
      title,
      tags: strList(payload.tags ?? [], "tags"),
      servings:
        payload.servings === "" || payload.servings === null || payload.servings === undefined
          ? null
          : num(payload.servings, "servings"),
      sourceUrl: str(payload.sourceUrl ?? "", "sourceUrl").trim(),
      ingredients: strList(payload.ingredients ?? [], "ingredients"),
      steps: strList(payload.steps ?? [], "steps"),
    });
    await vault.writeFile(recipePath(slug), note);
    return ok({ ok: true, slug });
  });
}
