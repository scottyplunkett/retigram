"use client";

import { useEffect, useRef, useState } from "react";
import type { Suggestion } from "@/lib/schema";
import type { Usage } from "@/lib/agent/usage";

export type ChatMessage = { role: "user" | "assistant" | "error"; text: string; usage?: Usage };

export function formatUsage(u?: Usage) {
  if (!u) return "";
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `$${u.costUsd.toFixed(4)} · ${k(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens)} in (${k(u.cacheReadTokens)} cached) · ${k(u.outputTokens)} out`;
}

export default function ChatPanel({
  messages,
  suggestions,
  status,
  busy,
  disabled,
  total,
  onSend,
  onStop,
}: {
  messages: ChatMessage[];
  suggestions: Suggestion[];
  status: string[];
  busy: boolean;
  disabled: boolean;
  total?: Usage;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function scrollFn() {
      end.current?.scrollIntoView({ block: "end" });
    }
    return () => scrollFn();
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim() || busy || disabled) return;
    onSend(text.trim());
    setDraft("");
  };

  return (
    <section className="chat" aria-label="Edit with Claude">
      <div className="chat-head">
        <strong>Edit with Claude</strong>
        {total && total.costUsd > 0 && <small title="Total for this session">{formatUsage(total)}</small>}
      </div>
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="hint">
            {disabled
              ? "Convert a diagram or map a repo first."
              : "Ask for changes, e.g. “bold border on the decision nodes” or “add a Retry step after Build”."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div>{m.text}</div>
            {m.usage && <small>{formatUsage(m.usage)}</small>}
          </div>
        ))}
        {busy && (
          <div className="msg status">
            {(status.length ? status.slice(-3) : ["Working"]).map((s, i) => (
              <div key={i}>{s}…</div>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      {suggestions.length > 0 && !busy && (
        <div className="chips">
          {suggestions.map((s, i) => (
            <button key={i} className="chip" onClick={() => send(s.prompt)} title={s.prompt} disabled={disabled}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <textarea
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? "" : "Describe a change…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        {busy ? (
          <button className="secondary" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="primary" disabled={disabled || !draft.trim()} onClick={() => send(draft)}>
            Send
          </button>
        )}
      </div>
    </section>
  );
}
