import { WeekScreen } from "@/components/WeekScreen";
import { listDrafts, listRecipes, listTemplates, readCurrentWeek } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const [week, drafts, templates, recipes] = await Promise.all([
    readCurrentWeek(),
    listDrafts(),
    listTemplates(),
    listRecipes(),
  ]);

  return (
    <WeekScreen
      week={{ weekOf: week.weekOf, title: week.title, table: week.table }}
      drafts={drafts}
      templates={templates}
      recipes={recipes.map((r) => ({ slug: r.slug, title: r.title, tags: r.tags }))}
    />
  );
}
