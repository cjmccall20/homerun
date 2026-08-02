import { body, fail, handle, ok, str, strList } from "@/lib/api";
import {
  RESTAURANT_FAVORITES,
  RESTAURANT_HISTORY,
  appendSectionItem,
  orderEntryLine,
  setPreferences,
  setSectionItems,
  type Preference,
} from "@/lib/parse/lists";
import { readPrefs, readRestaurants, readStaples } from "@/lib/store";
import * as vault from "@/lib/vault";

/**
 * Staples, restaurants and ingredient preferences: three bullet-list notes
 * behind one endpoint, because they are all "edit a section, save the section".
 */

export async function GET() {
  return handle(async () => {
    const [staples, restaurants, prefs] = await Promise.all([
      readStaples(),
      readRestaurants(),
      readPrefs(),
    ]);
    return ok({
      staples: { pantry: staples.pantry, house: staples.house },
      restaurants: {
        favorites: restaurants.favorites,
        history: restaurants.history,
      },
      prefs: prefs.prefs,
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const action = str(payload.action ?? "", "action");

    switch (action) {
      case "staples": {
        const pantry = strList(payload.pantry ?? [], "pantry");
        const house = strList(payload.house ?? [], "house");
        await vault.editFile(vault.FILES.staples, "# Groceries and Staples\n", (t) =>
          setSectionItems(
            setSectionItems(t, "Pantry staples", pantry),
            "House staples",
            house
          )
        );
        return ok({ ok: true });
      }
      case "restaurant-favorites": {
        const favorites = strList(payload.favorites ?? [], "favorites");
        await vault.editFile(vault.FILES.restaurants, "# Restaurants\n", (t) =>
          setSectionItems(t, RESTAURANT_FAVORITES, favorites)
        );
        return ok({ ok: true });
      }
      case "restaurant-order": {
        const line = orderEntryLine({
          date: str(payload.date ?? "", "date").trim(),
          restaurant: str(payload.restaurant ?? "", "restaurant").trim(),
          what: str(payload.what ?? "", "what").trim(),
          verdict: str(payload.verdict ?? "", "verdict").trim(),
        });
        if (!line) throw new Error("An order entry needs at least a restaurant.");
        await vault.editFile(vault.FILES.restaurants, "# Restaurants\n", (t) =>
          appendSectionItem(t, RESTAURANT_HISTORY, `## ${RESTAURANT_HISTORY}`, line)
        );
        return ok({ ok: true });
      }
      case "prefs": {
        const raw = payload.prefs;
        if (!Array.isArray(raw)) throw new Error("prefs must be a list");
        const prefs: Preference[] = raw.map((p) => {
          const entry = p as Record<string, unknown>;
          return {
            ingredient: str(entry.ingredient ?? "", "ingredient"),
            preference: str(entry.preference ?? "", "preference"),
          };
        });
        await vault.editFile(
          vault.FILES.prefs,
          "# Ingredient Preferences\n",
          (t) => setPreferences(t, prefs)
        );
        return ok({ ok: true });
      }
      default:
        return fail(`Unknown action: ${action}`);
    }
  });
}
