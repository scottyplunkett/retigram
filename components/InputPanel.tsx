"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImage } from "@/lib/image";
import { isGithubUrl } from "@/lib/repo/url";

type Mode = "image" | "text" | "repo";

export type ConvertRequest =
  { kind: "image"; image: Blob; notes: string } | { kind: "text"; text: string } | { kind: "repo"; url: string };

const TEXT_PLACEHOLDER = `Paste Mermaid, DOT, ASCII art or a plain description, e.g.

flowchart TD
  A[Order received] --> B{In stock?}
  B -- yes --> C[Ship order]
  B -- no --> D[Backorder]`;

export default function InputPanel({ busy, onConvert }: { busy: boolean; onConvert: (req: ConvertRequest) => void }) {
  const [mode, setMode] = useState<Mode>("image");
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(async (f: File | Blob | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    setError(null);
    try {
      const prepared = await prepareImage(f);
      setFile(prepared);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(prepared);
      });
      setMode("image");
    } catch {
      setError("Could not read that image. Try PNG, JPEG, WebP or GIF.");
    }
  }, []);

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        void accept(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  const canSubmit = !busy && (mode === "image" ? !!file : mode === "repo" ? isGithubUrl(url) : text.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "image") onConvert({ kind: "image", image: file!, notes });
    else if (mode === "repo") onConvert({ kind: "repo", url: url.trim() });
    // A bare GitHub URL in the text box maps the repository instead of drawing it.
    else if (isGithubUrl(text.trim())) onConvert({ kind: "repo", url: text.trim() });
    else onConvert({ kind: "text", text });
  };

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "image"} onClick={() => setMode("image")}>
          Image
        </button>
        <button role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>
          Text
        </button>
        <button role="tab" aria-selected={mode === "repo"} onClick={() => setMode("repo")}>
          GitHub
        </button>
      </div>

      {mode === "image" ? (
        <>
          <div
            className="dropzone"
            data-active={dragging}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void accept(e.dataTransfer.files[0]);
            }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Diagram to convert" />
            ) : (
              <>
                <strong>Drop a diagram image</strong>
                <span>or click to choose, or paste from the clipboard</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => void accept(e.target.files?.[0])}
            />
          </div>
          {preview && (
            <button
              className="link"
              onClick={() => {
                setFile(null);
                setPreview(null);
              }}
            >
              Remove image
            </button>
          )}
          <div className="field">
            <label htmlFor="notes">Notes (optional)</label>
            <textarea
              id="notes"
              rows={2}
              placeholder="e.g. ignore the legend; the red boxes are errors"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </>
      ) : mode === "repo" ? (
        <div className="field">
          <label htmlFor="repo-url">Repository URL</label>
          <input
            id="repo-url"
            className="text-input"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <p className="hint">
            Maps features to source in layers you can expand. Add /tree/branch/path to focus on a branch or folder.
            Private repos need GITHUB_TOKEN on the server.
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="source">Diagram text</label>
          <textarea
            id="source"
            className="mono"
            rows={14}
            placeholder={TEXT_PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <button className="primary" disabled={!canSubmit} onClick={submit}>
        {busy ? "Working…" : mode === "repo" ? "Map repository" : "Convert to React Flow"}
      </button>
    </>
  );
}
