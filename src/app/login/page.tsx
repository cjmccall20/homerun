import { Suspense } from "react";

import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">HomeRun</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Meals, groceries and honeydew for the house.
      </p>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
