"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PEOPLE } from "@/lib/people";
import { errorText, post } from "@/lib/client";
import { Button, ErrorNote } from "@/components/ui";

export function NamePicker({ current }: { current?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function choose(name: string) {
    setBusy(name);
    setError("");
    try {
      await post("/api/auth/name", { name });
      router.replace("/week");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mt-8 space-y-3">
      {PEOPLE.map((name) => (
        <Button
          key={name}
          variant={name === current ? "primary" : "quiet"}
          disabled={busy !== ""}
          onClick={() => choose(name)}
          className="w-full text-lg"
        >
          {busy === name ? "One second" : name}
        </Button>
      ))}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
