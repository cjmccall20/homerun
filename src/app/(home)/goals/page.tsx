import { GoalsScreen } from "@/components/GoalsScreen";
import { fromISO, todayISO } from "@/lib/dates";
import { currentWho } from "@/lib/session";
import { readGoals } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: raw } = await searchParams;
  const today = todayISO();
  const date = raw && fromISO(raw) ? raw : today;

  const [{ goals }, who] = await Promise.all([readGoals(date), currentWho()]);

  return <GoalsScreen date={date} today={today} goals={goals} me={who} />;
}
