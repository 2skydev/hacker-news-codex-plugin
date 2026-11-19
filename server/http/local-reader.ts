import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { READER_API_PATH } from "../../shared/constants/reader.constants.ts";
import { handleReaderRequest, isLocalHost } from "./reader-api.ts";

const html = await readFile(new URL("./index.html", import.meta.url));
const host = "127.0.0.1";
const server = createServer(async (req, res) => {
  if (!isLocalHost(req)) {
    res.writeHead(403).end();
    return;
  }
  if (req.url === READER_API_PATH) {
    await handleReaderRequest(req, res);
    return;
  }
  if (req.url?.split("?", 1)[0] !== "/" || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(req.method === "HEAD" ? undefined : html);
});

server.on("error", (error) => {
  console.error("Hacker News를 시작하지 못했습니다.", error.message);
  process.exitCode = 1;
});
server.listen(0, host, () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(`http://${host}:${address.port}`);
});
