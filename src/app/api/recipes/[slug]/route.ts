import { body, bool, fail, handle, num, ok, str, strList } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import { setFrontmatterKey } from "@/lib/md";
import {
  addComment,
  publishRecipe,
  setFavorite,
  setRating,
  updateRecipeNote,
} from "@/lib/parse/recipe";
import { readRecipe, recipePath } from "@/lib/store";
import { normalizeTag } from "@/lib/tag-taxonomy";
import { currentWho } from "@/lib/session";
import * as vault from "@/lib/vault";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const recipe = await readRecipe(slug);
    if (!recipe) return fail("No such recipe.", 404);
    return ok({ recipe });
  });
}

/** Full form save. */
export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const rel = recipePath(slug);
    if (!(await vault.exists(rel))) return fail("No such recipe.", 404);

    const payload = await body<Record<string, unknown>>(request);
    const title = str(payload.title ?? "", "title").trim();
    if (!title) throw new Error("A recipe needs a title.");

    await vault.editFile(rel, "", (text) =>
      updateRecipeNote(text, {
        title,
        tags: strList(payload.tags ?? [], "tags"),
        servings:
          payload.servings === "" ||
          payload.servings === null ||
          payload.servings === undefined
            ? null
            : num(payload.servings, "servings"),
        sourceUrl: str(payload.sourceUrl ?? "", "sourceUrl").trim(),
        ingredients: strList(payload.ingredients ?? [], "ingredients"),
        steps: strList(payload.steps ?? [], "steps"),
      })
    );
    return ok({ ok: true, slug: vault.safeName(slug) });
  });
}

/** The one-tap edits: rating, favorite, comment. */
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const rel = recipePath(slug);
    if (!(await vault.exists(rel))) return fail("No such recipe.", 404);

    const payload = await body<Record<string, unknown>>(request);
    const action = str(payload.action ?? "", "action");
    const who = await currentWho();

    switch (action) {
      case "rate": {
        const raw = payload.stars;
        const stars =
          raw === null || raw === "" || raw === undefined
            ? null
            : Math.max(1, Math.min(5, Math.round(num(raw, "stars"))));
        await vault.editFile(rel, "", (text) => setRating(text, who, stars));
        return ok({ ok: true, stars });
      }
      case "favorite": {
        const favorite = bool(payload.favorite, "favorite");
        await vault.editFile(rel, "", (text) => setFavorite(text, favorite));
        return ok({ ok: true, favorite });
      }
      case "tags": {
        // Tag editing is its own action so adding "grilling" to a recipe does
        // not require sending the whole note back and cannot disturb the body.
        const tags = strList(payload.tags ?? [], "tags")
          .map(normalizeTag)
          .filter(Boolean);
        const unique = [...new Set(tags)];
        await vault.editFile(rel, "", (text) =>
          setFrontmatterKey(text, "tags", unique)
        );
        return ok({ ok: true, tags: unique });
      }
      case "publish": {
        // Publishing only drops the draft marker. Everything the reviewer
        // edited was already saved by the form; this is the moment the recipe
        // becomes visible to the planner, the picker and the grocery run.
        await vault.editFile(rel, "", publishRecipe);
        return ok({ ok: true, published: true });
      }
      case "comment": {
        const text = str(payload.text ?? "", "text").trim();
        if (!text) throw new Error("A comment needs some text.");
        await vault.editFile(rel, "", (current) =>
          addComment(current, todayISO(), who, text)
        );
        return ok({ ok: true });
      }
      default:
        return fail(`Unknown action: ${action}`);
    }
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    await vault.deleteNote(vault.DIRS.recipes, slug);
    return ok({ ok: true });
  });
}
