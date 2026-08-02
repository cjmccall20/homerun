"use client";

import { useEffect, useRef } from "react";

/**
 * The handful of primitives every screen shares. Deliberately small: this app
 * has five tabs, and a component library would weigh more than the app.
 */

type ButtonVariant = "primary" | "quiet" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink border-transparent",
  quiet: "bg-surface text-ink border-line",
  ghost: "bg-transparent text-ink-soft border-transparent",
  danger: "bg-transparent text-danger border-line",
};

export function Button({
  variant = "quiet",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-[0.95rem] font-medium transition-opacity active:opacity-60 disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

const INPUT_CLASS =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-ink placeholder:text-ink-faint";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${INPUT_CLASS} ${className}`} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const { className = "", ...rest } = props;
  return (
    <textarea {...rest} className={`${INPUT_CLASS} leading-relaxed ${className}`} />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select {...rest} className={`${INPUT_CLASS} min-h-12 ${className}`} />
  );
}

export function Card({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-line bg-surface ${className}`}
    />
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </h2>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
      {children}
    </p>
  );
}

export function Pill({
  active = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={`min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors ${
        active
          ? "border-transparent bg-accent text-accent-ink"
          : "border-line bg-surface text-ink-soft"
      } ${className}`}
    />
  );
}

/**
 * A bottom sheet. Phones edit in sheets, not modals: the content rises from
 * where the thumb already is, and tapping the backdrop is the escape hatch.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-line bg-canvas pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} className="px-3">
            Done
          </Button>
        </div>
        <div className="space-y-4 px-4 pt-4">{children}</div>
      </div>
    </div>
  );
}

export function Stars({
  value,
  onChange,
  size = "md",
}: {
  value: number | null;
  onChange?: (stars: number | null) => void;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "text-base" : "text-2xl";
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        const label = `${n} star${n === 1 ? "" : "s"}`;
        if (!onChange) {
          return (
            <span
              key={n}
              aria-hidden
              className={`${dim} ${on ? "text-warn" : "text-ink-faint/40"}`}
            >
              {on ? "★" : "☆"}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            aria-label={label}
            aria-pressed={on}
            onClick={() => onChange(value === n ? null : n)}
            className={`flex h-11 w-9 items-center justify-center ${dim} ${
              on ? "text-warn" : "text-ink-faint/50"
            }`}
          >
            {on ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}
