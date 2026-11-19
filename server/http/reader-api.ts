import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { registerReaderTools } from "../reader-tools.ts";

const maxBodyBytes = 128_000;
const requestSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});
const tools = new Map<
  string,
  (args: Record<string, unknown>, res: ServerResponse) => Promise<void>
>();

function send(res: ServerResponse, data: object) {
  if (res.destroyed) return;
  const body = JSON.stringify(data);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

registerReaderTools((name, _title, schema, _readOnly, run) => {
  const input = z.object(schema);
  tools.set(name, async (args, res) => {
    const parsed = input.safeParse(args);
    if (!parsed.success) {
      res.writeHead(400).end();
      return;
    }
    try {
      send(res, { structuredContent: await run(parsed.data) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
      send(res, { isError: true, content: [{ type: "text", text: message }] });
    }
  });
});

export function isLocalHost(req: IncomingMessage) {
  const { host } = req.headers;
  const port = req.socket.localPort;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

export async function handleReaderRequest(req: IncomingMessage, res: ServerResponse) {
  if (
    req.method !== "POST" ||
    !isLocalHost(req) ||
    req.headers.origin !== `http://${req.headers.host}` ||
    req.headers["content-type"] !== "application/json"
  ) {
    res.writeHead(403).end();
    return;
  }

  let payload: unknown;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        res.writeHead(413, { Connection: "close" }).end();
        return;
      }
      chunks.push(chunk);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    if (!res.destroyed) res.writeHead(400).end();
    return;
  }

  const parsed = requestSchema.safeParse(payload);
  const tool = parsed.success && tools.get(parsed.data.name);
  if (!parsed.success || !tool) {
    res.writeHead(400).end();
    return;
  }
  if (!res.destroyed) await tool(parsed.data.args ?? {}, res);
}
