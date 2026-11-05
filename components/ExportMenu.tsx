"use client";

import { useEffect, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { serializeFlow } from "@/lib/serialize";
import type { Graph } from "@/lib/ops";

export default function ExportMenu({
  title,
  nodes,
  edges,
  dirty,
  onApply,
  onToast,
}: {
  title: string;
  nodes: Node[];
  edges: Edge[];
  /** The canvas differs from the default configuration (`nodes`/`edges` are the default). */
  dirty: boolean;
  /** Make the canvas the default and return it. */
  onApply: () => Graph;
  onToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const empty = nodes.length === 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const copy = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(serializeFlow(nodes, edges));
      onToast("Node definitions copied");
    } catch {
      onToast("Clipboard is unavailable in this browser");
    }
  };

  const download = async (g: Graph = { nodes, edges }) => {
    setOpen(false);
    setDownloading(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, nodes: g.nodes, edges: g.edges }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "flow.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      onToast(`Downloaded ${name}. Unzip it and run npm start.`);
    } catch (err) {
      onToast(`Export failed: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button
        className="secondary"
        disabled={empty || downloading}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {downloading ? "Preparing…" : "Export ▾"}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {dirty && (
            <>
              <p className="menu-note">Canvas has changes that aren&apos;t in the default</p>
              <button role="menuitem" onClick={() => download(onApply())}>
                Apply and export
                <small>Make the canvas the default, then download the project</small>
              </button>
            </>
          )}
          <button role="menuitem" onClick={copy}>
            Copy node definitions
            <small>TypeScript initialNodes / initialEdges</small>
          </button>
          <button role="menuitem" onClick={() => download()}>
            Download complete project
            <small>Vite + React Flow app, run with npm start</small>
          </button>
        </div>
      )}
    </div>
  );
}
