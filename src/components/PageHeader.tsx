export function PageHeader({
  title,
  count,
  subtitle,
  action,
}: {
  title: string;
  /** Small badge beside the title. Hidden when zero. */
  count?: number;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <span className="truncate">{title}</span>
          {count ? (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold text-accent-ink">
              {count}
            </span>
          ) : null}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </header>
  );
}
