"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { Graph } from "@/lib/ops";
import { diffGraphs, graphToText, isEmptyDiff, parseConfig, summarizeDiff } from "@/lib/configText";

export default function ConfigPanel({
  nodes,
  edges,
  committed,
  getLive,
  onApplyText,
  onApplyDefault,
  onRevert,
  onClose,
  onToast,
}: {
  nodes: Node[];
  edges: Edge[];
  committed: Graph;
  getLive: () => Graph;
  onApplyText: (g: Graph) => void;
  onApplyDefault: () => void;
  onRevert: () => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  // Deferred so rebuilding the text never blocks dragging.
  const liveNodes = useDeferredValue(nodes);
  const liveEdges = useDeferredValue(edges);
  const liveText = useMemo(() => graphToText({ nodes: liveNodes, edges: liveEdges }), [liveNodes, liveEdges]);
  const diff = useMemo(
    () => diffGraphs(committed, { nodes: liveNodes, edges: liveEdges }),
    [committed, liveNodes, liveEdges],
  );
  const same = isEmptyDiff(diff);

  // While the user types, the text stops following the canvas.
  const [draft, setDraft] = useState<string | null>(null);
  // The canvas text at the moment editing started; used to notice later canvas changes.
  const [seen, setSeen] = useState(liveText);
  const [errors, setErrors] = useState<string[]>([]);
  const stale = draft !== null && liveText !== seen;

  const reload = () => {
    setDraft(null);
    setErrors([]);
  };

  const applyText = () => {
    if (draft === null) return;
    const r = parseConfig(draft, getLive());
    if ("errors" in r) return setErrors(r.errors);
    onApplyText(r.graph);
    reload();
    onToast("Applied to the canvas");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft ?? liveText);
      onToast("Config copied");
    } catch {
      onToast("Clipboard is unavailable in this browser");
    }
  };

  return (
    <section className="config" aria-label="Node configuration">
      <div className="config-head">
        <h3>Config</h3>
        <button className="close" aria-label="Close config" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="config-summary" role="status">
        {summarizeDiff(diff)}
      </p>
      <div className="config-actions">
        <button className="primary" onClick={onApplyDefault} disabled={same}>
          Apply as default
        </button>
        <button className="secondary" onClick={onRevert} disabled={same}>
          Revert
        </button>
        <button className="secondary" onClick={copy}>
          Copy
        </button>
      </div>
      {stale && (
        <div className="notice">
          <span>Canvas changed while you were editing</span>
          <button className="secondary" onClick={reload}>
            Reload from canvas
          </button>
        </div>
      )}
      <textarea
        className="mono"
        aria-label="Node configuration JSON"
        spellCheck={false}
        value={draft ?? liveText}
        onChange={(e) => {
          if (draft === null) setSeen(liveText);
          setDraft(e.target.value);
          setErrors([]);
        }}
      />
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="config-actions">
        <button className="primary" onClick={applyText} disabled={draft === null}>
          Apply text
        </button>
        {draft !== null && (
          <button className="secondary" onClick={reload}>
            Discard edits
          </button>
        )}
      </div>
    </section>
  );
}
