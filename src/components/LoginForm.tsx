"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { errorText, post } from "@/lib/client";
import { Button, ErrorNote, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { pin });
      router.replace(params.get("next") ?? "/week");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-4">
      <Input
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        placeholder="PIN"
        aria-label="Household PIN"
        className="text-center tracking-[0.5em]"
      />
      <ErrorNote>{error}</ErrorNote>
      <Button
        type="submit"
        variant="primary"
        disabled={busy || pin.length === 0}
        className="w-full"
      >
        {busy ? "Checking" : "Open HomeRun"}
      </Button>
    </form>
  );
}
