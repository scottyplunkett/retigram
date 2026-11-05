"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODELS, MODELS, parseModels, type ModelChoice, type ModelId } from "@/lib/models";

const KEY = "retigram.models";

export function loadModels(): ModelChoice {
  try {
    return parseModels(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_MODELS;
  }
}

export default function ModelSettings({ value, onChange }: { value: ModelChoice; onChange: (m: ModelChoice) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as globalThis.Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const set = (k: keyof ModelChoice, v: ModelId) => {
    const next = { ...value, [k]: v };
    onChange(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const select = (k: keyof ModelChoice, label: string, hint: string) => (
    <label className="setting">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <select value={value[k]} onChange={(e) => set(k, e.target.value as ModelId)}>
        {Object.entries(MODELS).map(([id, m]) => (
          <option key={id} value={id}>
            {m.label} ({m.note})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="menu" ref={ref}>
      <button className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Models">
        {MODELS[value.coordinator].label.split(" ")[0]} / {MODELS[value.worker].label.split(" ")[0]} ▾
      </button>
      {open && (
        <div className="menu-list settings">
          {select("coordinator", "Coordinator", "Converts diagrams, maps repos, handles chat edits")}
          {select("worker", "Workers", "Illustrations, themes, repo feature breakdowns")}
        </div>
      )}
    </div>
  );
}
