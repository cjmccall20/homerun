import { cookies } from "next/headers";

import { body, fail, handle, ok, str } from "@/lib/api";
import { SESSION_COOKIE, SESSION_MAX_AGE, checkPin, makeSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  return handle(async () => {
    const { pin } = await body<{ pin?: unknown }>(request);
    if (!checkPin(str(pin ?? "", "pin"))) {
      return fail("That PIN did not work.", 401);
    }
    const store = await cookies();
    store.set(SESSION_COOKIE, makeSessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return ok({ ok: true });
  });
}
