import { NextResponse } from "next/server";
import { convertDiagram, IMAGE_TYPES, type ImageMediaType } from "@/lib/agent/convert";
import { AgentError } from "@/lib/agent/run";
import { parseModels } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }
  const image = form.get("image");
  const text = form.get("text");
  const notes = form.get("notes");
  let models;
  try {
    models = parseModels(JSON.parse(String(form.get("models") ?? "{}")));
  } catch {
    models = parseModels(null);
  }

  try {
    if (image instanceof File && image.size > 0) {
      if (!IMAGE_TYPES.includes(image.type as ImageMediaType)) {
        return NextResponse.json({ error: `Unsupported image type: ${image.type || "unknown"}` }, { status: 415 });
      }
      if (image.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Image is larger than 5 MB." }, { status: 413 });
      }
      const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
      const out = await convertDiagram(
        {
          kind: "image",
          mediaType: image.type as ImageMediaType,
          base64,
          notes: typeof notes === "string" && notes.trim() ? notes.trim() : undefined,
        },
        models.coordinator,
        req.signal,
      );
      return NextResponse.json(out);
    }
    if (typeof text === "string" && text.trim()) {
      if (text.length > MAX_TEXT_CHARS) return NextResponse.json({ error: "Text input is too long." }, { status: 413 });
      const out = await convertDiagram({ kind: "text", text: text.trim() }, models.coordinator, req.signal);
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: "Provide an image or some text." }, { status: 400 });
  } catch (err) {
    if (err instanceof AgentError) {
      return NextResponse.json({ error: err.message, usage: err.usage }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
