import { TabBar } from "@/components/TabBar";

/**
 * The signed-in shell. Everything under this route group gets the tab bar and
 * enough bottom padding that the last row of content is never trapped under it.
 */
export default function HomeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
        {children}
      </div>
      <TabBar />
    </>
  );
}
