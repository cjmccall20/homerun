import { BudgetScreen } from "@/components/BudgetScreen";
import { readBudgetSnapshot } from "@/lib/budget";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const snapshot = await readBudgetSnapshot();
  return <BudgetScreen snapshot={snapshot} />;
}
