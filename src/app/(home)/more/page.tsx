import { MoreScreen } from "@/components/MoreScreen";
import { otherPrefSections } from "@/lib/parse/lists";
import { currentWho } from "@/lib/session";
import {
  listArchive,
  listRecipes,
  listTemplates,
  readPrefs,
  readRestaurants,
  readStaples,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const [staples, restaurants, prefs, who, recipes, templates, archive] =
    await Promise.all([
      readStaples(),
      readRestaurants(),
      readPrefs(),
      currentWho(),
      listRecipes("live"),
      listTemplates(),
      listArchive(),
    ]);

  return (
    <MoreScreen
      me={who}
      staples={{ pantry: staples.pantry, house: staples.house }}
      restaurants={{
        favorites: restaurants.favorites,
        history: restaurants.history,
      }}
      prefs={prefs.prefs}
      prefNotes={otherPrefSections(prefs.raw)}
      favorites={recipes
        .filter((r) => r.favorite)
        .map((r) => ({ slug: r.slug, title: r.title, tags: r.tags }))}
      savedWeeks={[
        ...templates.map((w) => ({ ...w, scope: "template" as const })),
        ...archive.map((w) => ({ ...w, scope: "archive" as const })),
      ]}
    />
  );
}
