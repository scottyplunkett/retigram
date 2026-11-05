/** Server-sent events response. `run` gets a `send` function; errors become an `error` event. */
export function sseResponse(
  run: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send, signal);
      } catch (err) {
        const e = err as { message?: string; status?: number; usage?: unknown };
        send("error", { message: e.message ?? "Unexpected error.", status: e.status ?? 500, usage: e.usage });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
