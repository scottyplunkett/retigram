import { NextResponse } from "next/server";
import type { Edge, Node } from "@xyflow/react";
import { buildProjectZip } from "@/lib/projectZip";

export const runtime = "nodejs";

type Body = { title?: unknown; nodes?: unknown; edges?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json({ error: "Body must include nodes and edges arrays." }, { status: 400 });
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Flow diagram";

  const { filename, buffer } = await buildProjectZip(title, body.nodes as Node[], body.edges as Edge[]);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
