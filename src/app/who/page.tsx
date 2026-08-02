import { NamePicker } from "@/components/NamePicker";

export default function WhoPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Who is this?</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Used for ratings, comments and the Mine filter. You can change it later
        under More.
      </p>
      <NamePicker />
    </main>
  );
}
