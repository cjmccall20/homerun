import { cookies } from "next/headers";

import { handle, ok } from "@/lib/api";
import { SESSION_COOKIE, WHO_COOKIE } from "@/lib/auth";

export async function POST() {
  return handle(async () => {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    store.delete(WHO_COOKIE);
    return ok({ ok: true });
  });
}
