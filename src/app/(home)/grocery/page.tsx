import { GroceryScreen } from "@/components/GroceryScreen";
import { latestOrder } from "@/lib/orders";
import { toPlainText } from "@/lib/parse/grocery";
import {
  listGroceryWeeks,
  readGrocery,
  readGroceryWeek,
  readThread,
} from "@/lib/store";
import { currentWho } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function GroceryPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weeks = await listGroceryWeeks();
  const currentWeek = weeks.find((w) => w.current)?.weekOf ?? "";
  const viewing = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : currentWeek;
  const isCurrent = viewing === currentWeek;

  const [live, order, who] = await Promise.all([
    readGrocery(),
    latestOrder(),
    currentWho(),
  ]);
  const past = isCurrent ? null : await readGroceryWeek(viewing);
  const list = past ?? live;
  const entries = await readThread(viewing);
  return (
    <GroceryScreen
      list={{
        generatedFrom: list.generatedFrom,
        generatedOn: list.generatedOn,
        categories: list.categories,
        total: list.total,
        checked: list.checked,
      }}
      plain={toPlainText(list)}
      order={isCurrent ? order : null}
      weeks={weeks}
      viewing={viewing}
      isCurrent={isCurrent}
      thread={entries}
      me={who}
      missingSnapshot={!isCurrent && past === null}
    />
  );
}
