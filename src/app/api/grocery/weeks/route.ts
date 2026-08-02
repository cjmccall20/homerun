import { handle, ok } from "@/lib/api";
import { listGroceryWeeks } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ok({ weeks: await listGroceryWeeks() }));
}
