"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { ExpandContext, hasChildren, setExpanded, type RepoNodeData } from "@nodes";
import InputPanel, { type ConvertRequest } from "@/components/InputPanel";
import FlowViewer from "@/components/FlowViewer";
import ExportMenu from "@/components/ExportMenu";
import ConfigPanel from "@/components/ConfigPanel";
import ChatPanel, { type ChatMessage } from "@/components/ChatPanel";
import ModelSettings, { loadModels } from "@/components/ModelSettings";
import { countOverlaps, toXyflow } from "@/lib/toXyflow";
import { autoLayout, type Direction } from "@/lib/layout";
import { applyOps, type Graph, type Op } from "@/lib/ops";
import { cropFigure, figureNodes } from "@/lib/crop";
import { mergeGraphs, slimGraph } from "@/lib/merge";
import { diffGraphs, isEmptyDiff } from "@/lib/configText";
import { postSSE } from "@/lib/sseClient";
import { mergeExpansion, type Expansion } from "@/lib/repo/nodes";
import { DEFAULT_MODELS, type ModelChoice } from "@/lib/models";
import { addUsage, emptyUsage, type Usage } from "@/lib/agent/usage";
import type { FlowSpec, Suggestion } from "@/lib/schema";
import type { RepoContext } from "@/lib/repo/schema";

function Workspace() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const graphRef = useRef<Graph>({ nodes, edges });
  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [nodes, edges]);

  // The default configuration: what Export uses. The canvas (nodes/edges) is the live copy.
  const [committed, setCommitted] = useState<Graph>({ nodes: [], edges: [] });
  const [configOpen, setConfigOpen] = useState(false);
  const deferredNodes = useDeferredValue(nodes);
  const deferredEdges = useDeferredValue(edges);
  const dirty = useMemo(
    () => !isEmptyDiff(diffGraphs(committed, { nodes: deferredNodes, edges: deferredEdges })),
    [committed, deferredNodes, deferredEdges],
  );

  const [title, setTitle] = useState("Untitled diagram");
  const [direction, setDirection] = useState<Direction>("TB");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
  const [repo, setRepo] = useState<RepoContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [expanding, setExpanding] = useState(0);
  const [total, setTotal] = useState<Usage>(emptyUsage());
  const abortRef = useRef<AbortController | null>(null);
  const { fitView } = useReactFlow();

  useEffect(() => setModels(loadModels()), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const setGraph = useCallback(
    (g: Graph) => {
      graphRef.current = g;
      setNodes(g.nodes);
      setEdges(g.edges);
    },
    [setNodes, setEdges],
  );

  const refit = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 })));
  }, [fitView]);

  const addTotal = (u?: Usage) => u && setTotal((t) => addUsage(t, u));

  const resetConversation = (intro: ChatMessage, chips: Suggestion[]) => {
    setMessages([intro]);
    setSuggestions(chips);
    setStatus([]);
  };

  // ---- Diagram conversion -------------------------------------------------------------
  const convertDiagram = async (req: Extract<ConvertRequest, { kind: "image" | "text" }>) => {
    const form = new FormData();
    form.set("models", JSON.stringify(models));
    if (req.kind === "image") {
      form.set("image", req.image, "diagram");
      if (req.notes.trim()) form.set("notes", req.notes.trim());
    } else {
      form.set("text", req.text);
    }
    setBusyText("Reading the diagram");
    const res = await fetch("/api/convert", { method: "POST", body: form });
    const json = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
    addTotal(json.usage);
    if (!res.ok) throw new Error(json.error ?? `Server returned ${res.status}`);
    const spec = json.spec as FlowSpec;

    let flow: Graph = toXyflow(spec);
    if (req.kind === "image" && spec.figures.length) {
      const crops = await Promise.all(
        spec.figures.map(async (f) => ({ ...f, crop: await cropFigure(req.image, f.box).catch(() => null) })),
      );
      const ok = crops.filter((c): c is typeof c & { crop: NonNullable<typeof c.crop> } => !!c.crop);
      flow = { ...flow, nodes: [...flow.nodes, ...figureNodes(flow.nodes, ok)] };
    }
    if (countOverlaps(flow.nodes) > 0) flow = autoLayout(flow.nodes, flow.edges, spec.direction);
    setGraph(flow);
    setCommitted(flow);
    setRepo(null);
    setTitle(spec.title || "Untitled diagram");
    setDirection(spec.direction);
    setWarnings(
      spec.nodes.length === 0 && spec.warnings.length === 0 ? ["No diagram was found in the input."] : spec.warnings,
    );
    resetConversation(
      {
        role: "assistant",
        text: `Converted ${spec.nodes.length} nodes and ${spec.edges.length} edges${spec.figures.length ? `, plus ${spec.figures.length} figure(s) cropped from the source` : ""}.`,
        usage: json.usage,
      },
      spec.suggestions,
    );
    refit();
  };

  // ---- Repository map -----------------------------------------------------------------
  const mapRepo = async (url: string) => {
    setBusyText("Connecting to GitHub");
    let mapped = false;
    await postSSE(
      "/api/repo",
      JSON.stringify({ url, models }),
      { "Content-Type": "application/json" },
      (event, data) => {
        if (event === "status") setBusyText(data.text);
        else if (event === "overview") {
          mapped = true;
          const laid = autoLayout(data.graph.nodes, data.graph.edges, "TB");
          setGraph(laid);
          setCommitted(laid);
          setRepo(data.ctx);
          setTitle(`${data.title} (${data.ctx.owner}/${data.ctx.repo}@${data.ctx.sha.slice(0, 7)})`);
          setDirection("TB");
          setWarnings(data.stats.truncated ? ["The repository is large; only part of it was scanned."] : []);
          addTotal(data.usage);
          resetConversation(
            {
              role: "assistant",
              text: `${data.summary} ${data.graph.nodes.filter((n: Node) => n.type === "repo").length} features cover ${data.stats.covered} of ${data.stats.files} files${data.cached ? " (cached map)" : ""}. Press + expand on a feature, or ask a question.`,
              usage: data.usage,
            },
            data.suggestions,
          );
          refit();
        } else if (event === "error") throw new Error(data.message);
      },
    );
    if (!mapped) throw new Error("The repository could not be mapped.");
  };

  const convert = async (req: ConvertRequest) => {
    setBusy(true);
    setError(null);
    try {
      if (req.kind === "repo") await mapRepo(req.url);
      else await convertDiagram(req);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Expansion ----------------------------------------------------------------------
  const applyExpansion = useCallback(
    (e: Expansion) => {
      const merged = mergeExpansion(graphRef.current, e);
      const laid = autoLayout(merged.nodes, merged.edges, direction);
      setGraph(laid);
      setCommitted(laid);
      if (e.note) setToast(e.note);
    },
    [direction, setGraph],
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<RepoNodeData>) => {
      const g = graphRef.current;
      setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) });
    },
    [setGraph],
  );

  const expandRemote = useCallback(
    async (targets: Node[]) => {
      if (!repo || !targets.length) return;
      targets.forEach((t) => patchNode(t.id, { loading: true, error: undefined }));
      setExpanding((n) => n + targets.length);
      try {
        await postSSE(
          "/api/repo/expand",
          JSON.stringify({ repo, models, nodes: targets.map((t) => ({ id: t.id, data: t.data })) }),
          { "Content-Type": "application/json" },
          (event, data) => {
            if (event === "expansion") applyExpansion(data);
            else if (event === "node_error") patchNode(data.id, { loading: false, error: data.message });
            else if (event === "status") setStatus((s) => [...s.slice(-20), data.text]);
            else if (event === "done" && data.usage?.costUsd > 0) {
              addTotal(data.usage);
              setMessages((m) => [
                ...m,
                { role: "assistant", text: `Expanded ${targets.length} node(s).`, usage: data.usage },
              ]);
            } else if (event === "error") throw new Error(data.message);
          },
        );
      } catch (err) {
        targets.forEach((t) => patchNode(t.id, { loading: false, error: (err as Error).message }));
      } finally {
        setExpanding((n) => n - targets.length);
      }
    },
    [repo, models, applyExpansion, patchNode],
  );

  const toggle = useCallback(
    (id: string) => {
      const g = graphRef.current;
      const node = g.nodes.find((n) => n.id === id);
      if (!node) return;
      const d = node.data as RepoNodeData;
      if (d.expanded || hasChildren(g.nodes, id)) {
        const next = setExpanded(g.nodes, id, !d.expanded);
        const laid = autoLayout(next, g.edges, direction);
        setGraph(laid);
        setCommitted(laid);
      } else if (node.type === "repo" && d.expandable) {
        void expandRemote([node]);
      }
    },
    [direction, setGraph, expandRemote],
  );

  const expandAll = () => {
    const g = graphRef.current;
    const targets = g.nodes.filter(
      (n) =>
        n.type === "repo" &&
        !n.hidden &&
        (n.data as RepoNodeData).kind === "feature" &&
        (n.data as RepoNodeData).expandable &&
        !hasChildren(g.nodes, n.id),
    );
    const loaded = g.nodes.filter(
      (n) => n.type === "repo" && !n.hidden && !(n.data as RepoNodeData).expanded && hasChildren(g.nodes, n.id),
    );
    let next = g.nodes;
    for (const n of loaded) next = setExpanded(next, n.id, true);
    if (loaded.length) {
      const laid = autoLayout(next, g.edges, direction);
      setGraph(laid);
      setCommitted(laid);
    }
    void expandRemote(targets);
  };

  // ---- Chat edits ---------------------------------------------------------------------
  const sendChat = async (text: string) => {
    const history = messages
      .filter((m) => m.role !== "error")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setSuggestions([]);
    setStatus([]);
    setChatBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    // `base` is what the server last saw; each `graph` event is merged against it and the live canvas.
    const sent = slimGraph(graphRef.current);
    let base = sent;
    let pendingLayout = false;
    // ops/expansion events not yet followed by a `graph` event. An old server never sends one.
    let unconfirmed: Array<{ event: string; data: unknown }> = [];
    let gotDone = false;
    let completed = false;
    try {
      await postSSE(
        "/api/agent",
        JSON.stringify({ graph: sent, message: text, history, models, repo }),
        { "Content-Type": "application/json" },
        (event, data) => {
          if (event === "status") setStatus((s) => [...s.slice(-20), data.text]);
          else if (event === "graph") {
            // The server's result is authoritative. Merge it with anything the user did meanwhile.
            const theirs = data as Graph;
            let merged = mergeGraphs(base, graphRef.current, theirs);
            if (pendingLayout) merged = autoLayout(merged.nodes, merged.edges, direction);
            pendingLayout = false;
            unconfirmed = [];
            base = slimGraph(theirs);
            setGraph(merged);
          } else if (event === "ops") {
            unconfirmed.push({ event, data });
          } else if (event === "expansion") {
            unconfirmed.push({ event, data });
            pendingLayout = true;
          } else if (event === "suggestions") setSuggestions(data);
          else if (event === "done") {
            gotDone = true;
            completed = true;
            addTotal(data.usage);
            setMessages((m) => [...m, { role: "assistant", text: data.text || "Done.", usage: data.usage }]);
          } else if (event === "error") {
            gotDone = true;
            addTotal(data.usage);
            setMessages((m) => [...m, { role: "error", text: data.message }]);
          }
        },
        ac.signal,
      );
      if (unconfirmed.length) {
        let replay = graphRef.current;
        const errors: string[] = [];
        for (const u of unconfirmed) {
          if (u.event === "ops") {
            const r = applyOps(replay, u.data as Op[]);
            errors.push(...r.errors);
            replay = { nodes: r.nodes, edges: r.edges };
          } else {
            const merged = mergeExpansion(replay, u.data as Expansion);
            replay = autoLayout(merged.nodes, merged.edges, direction);
          }
        }
        setGraph(replay);
        if (errors.length)
          setMessages((m) => [...m, { role: "error", text: `Some changes were not applied: ${errors.join("; ")}` }]);
      }
      if (completed) setCommitted(graphRef.current);
      if (!gotDone)
        setMessages((m) => [...m, { role: "error", text: "The connection closed before the edit finished." }]);
    } catch (err) {
      if (!ac.signal.aborted) setMessages((m) => [...m, { role: "error", text: (err as Error).message }]);
      else setMessages((m) => [...m, { role: "error", text: "Stopped." }]);
    } finally {
      setChatBusy(false);
      abortRef.current = null;
    }
  };

  const relayout = () => {
    const g = graphRef.current;
    const laid = autoLayout(g.nodes, g.edges, direction);
    setGraph(laid);
    setCommitted(laid);
    refit();
  };

  const applyDefault = () => {
    const g = graphRef.current;
    setCommitted(g);
    return g;
  };
  const revertToDefault = () => setGraph(committed);

  const canExpandAll =
    !!repo &&
    nodes.some(
      (n) =>
        n.type === "repo" &&
        (n.data as RepoNodeData).kind === "feature" &&
        (n.data as RepoNodeData).expandable &&
        !(n.data as RepoNodeData).expanded,
    );

  return (
    <ExpandContext.Provider value={toggle}>
      <div className="app">
        <aside className="sidebar">
          <div>
            <h1 className="brand">Retigram</h1>
            <p>Turn a diagram, its text, or a GitHub repo into an interactive React Flow diagram.</p>
          </div>
          <InputPanel busy={busy} onConvert={convert} />
          {error && <div className="error">{error}</div>}
          <ChatPanel
            messages={messages}
            suggestions={suggestions}
            status={status}
            busy={chatBusy}
            disabled={!nodes.length || busy}
            total={total}
            onSend={sendChat}
            onStop={() => abortRef.current?.abort()}
          />
        </aside>

        <main className="stage">
          <div className="toolbar">
            <h2 title={title}>{nodes.length ? title : "No diagram yet"}</h2>
            {expanding > 0 && <span className="statusline">Expanding {expanding}…</span>}
            <ModelSettings value={models} onChange={setModels} />
            {repo && (
              <button className="secondary" onClick={expandAll} disabled={!canExpandAll || expanding > 0}>
                Expand all
              </button>
            )}
            <select
              className="secondary"
              aria-label="Layout direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              disabled={!nodes.length}
            >
              <option value="TB">Top to bottom</option>
              <option value="LR">Left to right</option>
              <option value="BT">Bottom to top</option>
              <option value="RL">Right to left</option>
            </select>
            <button className="secondary" onClick={relayout} disabled={!nodes.length}>
              Auto-layout
            </button>
            <button
              className="secondary"
              aria-pressed={configOpen}
              onClick={() => setConfigOpen((o) => !o)}
              disabled={!nodes.length}
            >
              Config
            </button>
            <ExportMenu
              title={title}
              nodes={committed.nodes}
              edges={committed.edges}
              dirty={dirty}
              onApply={applyDefault}
              onToast={setToast}
            />
          </div>

          <div className="workarea">
            <div className="canvas">
              <FlowViewer
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                setEdges={setEdges}
              />
              {!nodes.length && !busy && (
                <div className="empty">Upload an image, paste diagram text, or enter a GitHub repo URL.</div>
              )}
              {warnings.length > 0 && (
                <div className="banner" role="status">
                  <strong>Check these details</strong>
                  <ul>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <button className="close" aria-label="Dismiss" onClick={() => setWarnings([])}>
                    ×
                  </button>
                </div>
              )}
              {busy && (
                <div className="loading">
                  <div className="spinner" />
                  <span>
                    {busyText}… {elapsed}s
                  </span>
                </div>
              )}
            </div>
            {configOpen && (
              <ConfigPanel
                nodes={deferredNodes}
                edges={deferredEdges}
                committed={committed}
                getLive={() => graphRef.current}
                onApplyText={setGraph}
                onApplyDefault={applyDefault}
                onRevert={revertToDefault}
                onClose={() => setConfigOpen(false)}
                onToast={setToast}
              />
            )}
          </div>
        </main>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </ExpandContext.Provider>
  );
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
