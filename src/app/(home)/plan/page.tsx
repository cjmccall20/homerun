import { Planner } from "@/components/Planner";
import { listDrafts } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const drafts = await listDrafts();
  return <Planner drafts={drafts} />;
}
