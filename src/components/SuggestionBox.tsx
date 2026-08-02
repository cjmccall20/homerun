"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { errorText, get, pollJobOutcome, post } from "@/lib/client";
import type { FeedbackRequest } from "@/lib/feedback";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, Empty, ErrorNote, Pill, Textarea } from "@/components/ui";

/**
 * The Suggestion Box.
 *
 * This is somebody's first experience of software changing because they asked
 * it to, so every word here is deliberately unremarkable. No "submit", no
 * "ticket", no "issue", no status codes. You say what you want, and later it
 * either happened or somebody explains what was in the way.
 *
 * Two modes on purpose. A question should never become a change request, and a
 * change request should never get answered with an explanation of how the
 * current thing works.
 */

type Mode = "ask" | "suggest";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const POLL_MS = 5000;

export function SuggestionBox({
  me,
  initialRequests,
}: {
  me: string;
  initialRequests: FeedbackRequest[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("ask");
  const [requests, setRequests] = useState(initialRequests);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const working = requests.some(
    (r) => r.status === "received" || r.status === "building"
  );

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ requests: FeedbackRequest[] }>("/api/feedback");
      setRequests(data.requests);
    } catch {
      // A failed poll is not worth a message; the next one will land.
    }
  }, []);

  useEffect(() => {
    if (!working) return;
    timer.current = setTimeout(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [working, requests, refresh]);

  return (
    <>
      <div className="mb-2">
        <Link href="/more" className="inline-block min-h-12 py-3 text-sm text-ink-soft">
          Back to more
        </Link>
      </div>

      <PageHeader
        title="Suggestion box"
        subtitle="Ask how something works, or ask for it to work differently."
      />

      <div className="mb-5 flex gap-2">
        <Pill active={mode === "ask"} onClick={() => setMode("ask")}>
          Ask how to use it
        </Pill>
        <Pill active={mode === "suggest"} onClick={() => setMode("suggest")}>
          Suggest a change
        </Pill>
      </div>

      {mode === "ask" ? (
        <AskPanel me={me} />
      ) : (
        <SuggestPanel
          me={me}
          onSubmitted={(created) => {
            setRequests((current) => [created, ...current]);
            router.refresh();
          }}
        />
      )}

      <section className="mt-8">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          What you have asked for
        </h2>
        {requests.length === 0 ? (
          <Empty>
            Nothing yet. Anything you ask for shows up here, and you can watch
            it happen.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {requests.map((request) => (
              <li key={request.id}>
                <RequestCard request={request} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AskPanel({ me }: { me: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setBusy(true);
    setError("");
    setStatus("Having a look.");
    try {
      const { jobId } = await post<{ jobId: string }>("/api/help", {
        messages: history,
      });
      const result = await pollJobOutcome(jobId, setStatus);
      setMessages([
        ...history,
        { role: "assistant", content: result.text || "I am not sure about that one." },
      ]);
      setStatus("");
    } catch (err) {
      setError(errorText(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {messages.length === 0 ? (
        <Card className="px-4 py-4">
          <p className="text-sm text-ink-soft">
            Ask anything about how HomeRun works and you will get a plain answer.
            There is no wrong question here.
          </p>
          <div className="mt-3 space-y-2">
            {[
              "How do I plan the week?",
              "What happens when I check something off the grocery list?",
              "Where do the recipes I import go?",
            ].map((example) => (
              <button
                key={example}
                onClick={() => setDraft(example)}
                disabled={busy}
                className="w-full rounded-xl border border-line px-3 py-3 text-left text-sm active:bg-surface-2 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent text-accent-ink"
                    : "border border-line bg-surface"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {status ? (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-3 text-sm text-ink-faint">
          {status}
        </p>
      ) : null}
      <ErrorNote>{error}</ErrorNote>

      <div className="mt-3 space-y-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`What would you like to know, ${me}?`}
          aria-label="Your question"
        />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || draft.trim() === ""}
          onClick={send}
        >
          {busy ? "Thinking" : "Ask"}
        </Button>
      </div>
    </div>
  );
}

function SuggestPanel({
  me,
  onSubmitted,
}: {
  me: string;
  onSubmitted: (request: FeedbackRequest) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const data = await post<{ request: FeedbackRequest }>("/api/feedback", {
        text,
      });
      onSubmitted(data.request);
      setText("");
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="px-4 py-4">
      <p className="text-sm text-ink-soft">
        Describe what you want to be different, the way you would say it out
        loud. Something that annoys you counts. Something that is missing counts.
        You do not need to know how it would work.
      </p>
      <Textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="The grocery list should show how many things are left"
        aria-label="Your suggestion"
        className="mt-3"
      />
      <ErrorNote>{error}</ErrorNote>
      {sent ? (
        <p className="mt-2 text-sm text-accent">
          Got it. It is in the list below and you can watch it happen.
        </p>
      ) : null}
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={busy || text.trim() === ""}
        onClick={submit}
      >
        {busy ? "Sending" : `Send it as ${me}`}
      </Button>
      <p className="mt-2 text-xs text-ink-faint">
        Small things get built within a few minutes. Bigger ones come back with
        a note about what is needed.
      </p>
    </Card>
  );
}

const STATUS_LABEL: Record<FeedbackRequest["status"], string> = {
  received: "Just asked",
  building: "Being built now",
  shipped: "Done",
  snag: "Needs a hand",
};

const STATUS_STYLE: Record<FeedbackRequest["status"], string> = {
  received: "border-line",
  building: "border-accent/50",
  shipped: "border-accent/50 bg-accent-soft",
  snag: "border-warn/50",
};

function RequestCard({ request }: { request: FeedbackRequest }) {
  return (
    <Card className={`px-4 py-3 ${STATUS_STYLE[request.status]}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {STATUS_LABEL[request.status]}
        </p>
        <p className="text-xs text-ink-faint">
          {request.who}, {friendlyDate(request.date)}
        </p>
      </div>

      <p className="mt-1.5 text-[0.95rem]">{request.text}</p>

      {request.status === "building" ? (
        <p className="mt-2 text-sm text-ink-soft">
          Working on it now. This usually takes a few minutes.
        </p>
      ) : null}

      {request.status === "shipped" ? (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-sm">{request.changelog || "It is done."}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Shipped from {request.who}&apos;s suggestion
            {request.commit ? ` (${request.commit})` : ""}. Reload the app to see it.
          </p>
        </div>
      ) : null}

      {request.status === "snag" ? (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-sm">{request.blocker || "Something got in the way."}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Nothing was changed. Cooper will see this one.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function friendlyDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
