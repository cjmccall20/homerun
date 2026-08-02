import { fail, handle, ok } from "@/lib/api";
import { readBudgetSnapshot } from "@/lib/budget";

export async function GET() {
  return handle(async () => {
    const snapshot = await readBudgetSnapshot();
    if (!snapshot) return fail("No budget snapshot yet - run budget-sync", 503);
    return ok({ snapshot });
  });
}
