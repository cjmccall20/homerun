import { cookies } from "next/headers";

import { WHO_COOKIE, readWho, type Who } from "@/lib/auth";

/**
 * Who is holding the phone. The proxy has already guaranteed a valid name
 * cookie exists by the time any page or route handler runs, so the fallback
 * only matters if someone hand-edits their cookies.
 */
export async function currentWho(): Promise<Who> {
  const store = await cookies();
  return readWho(store.get(WHO_COOKIE)?.value) ?? "Cooper";
}
