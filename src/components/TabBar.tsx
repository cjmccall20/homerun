"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Five tabs, fixed to the bottom, sized for thumbs and padded for the iPhone
 * home indicator. The icons are inline SVG paths rather than an icon package:
 * five glyphs is not worth a dependency.
 */

const TABS = [
  { href: "/week", label: "Week", icon: "M3 5h18M3 12h18M3 19h18" },
  {
    href: "/recipes",
    label: "Recipes",
    icon: "M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Zm4 4h7M8 12h7",
  },
  {
    href: "/grocery",
    label: "Grocery",
    icon: "M4 5h2l2.2 9.4a2 2 0 0 0 2 1.6h6.3a2 2 0 0 0 2-1.5L20 8H7m2 12h.01M17 20h.01",
  },
  {
    href: "/honeydew",
    label: "Honeydew",
    icon: "m4 12.5 4.5 4.5L20 6",
  },
  {
    href: "/goals",
    label: "Goals",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 3.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z",
  },
  {
    href: "/more",
    label: "More",
    icon: "M5 12h.01M12 12h.01M19 12h.01",
  },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[0.68rem] font-medium ${
                  active ? "text-accent" : "text-ink-faint"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.4 : 1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                  aria-hidden
                >
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
