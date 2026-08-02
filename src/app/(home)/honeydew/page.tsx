import { HoneydewScreen } from "@/components/HoneydewScreen";
import { todayISO } from "@/lib/dates";
import { currentWho } from "@/lib/session";
import { readHoneydew } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HoneydewPage() {
  const [data, who] = await Promise.all([readHoneydew(), currentWho()]);
  return (
    <HoneydewScreen
      data={{ tasks: data.tasks, done: data.done }}
      me={who}
      today={todayISO()}
    />
  );
}
