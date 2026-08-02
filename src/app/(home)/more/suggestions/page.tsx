import { SuggestionBox } from "@/components/SuggestionBox";
import { listRequests } from "@/lib/feedback";
import { currentWho } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage() {
  const [who, requests] = await Promise.all([currentWho(), listRequests()]);
  return <SuggestionBox me={who} initialRequests={requests} />;
}
