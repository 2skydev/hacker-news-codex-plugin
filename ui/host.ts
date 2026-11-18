import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import type { MouseEvent } from "react";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Notify, Preview, PreviewArgs, Tools } from "./types";

const app = new App({ name: "hacker-news", version: "0.3.9" }, {}, { autoResize: false });
function theme(context?: McpUiHostContext) {
  if (context?.theme) {
    applyDocumentTheme(context.theme);
    document.documentElement.classList.toggle("dark", context.theme === "dark");
  }
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  for (const [side, size] of Object.entries(context?.safeAreaInsets || {}))
    document.documentElement.style.setProperty("--safe-" + side, size + "px");
}
app.onhostcontextchanged = theme;
let connection: Promise<void> | undefined;
const standalone = import.meta.env.DEV && window.parent === window;
export function connectHost() {
  if (standalone) return Promise.resolve();
  if (window.parent === window) return Promise.reject(new Error("Codex에서 Hacker News 리더를 열어 주세요."));
  return connection ??= app.connect().then(() => theme(app.getHostContext()));
}
type RequestArgs<K extends keyof Tools> = Tools[K][0] extends undefined ? [] : [args: Tools[K][0], signal?: AbortSignal];
export function call<K extends keyof Tools>(name: K, ...params: RequestArgs<K>) {
  return invoke(name, params[0], params[1]);
}
async function invoke<K extends keyof Tools>(name: K, args: Tools[K][0], signal?: AbortSignal): Promise<Tools[K][1]> {
  await connectHost();
  const result = standalone ? await localTool(name, args, signal) :
    await app.callServerTool({ name, arguments: args ?? {} }, { signal, timeout: name === "hn_translate" ? 180000 : 60000 });
  if (result.isError) throw new Error(result.content?.find(block => block.type === "text")?.text || "요청을 완료하지 못했습니다.");
  return result.structuredContent as unknown as Tools[K][1];
}
async function localTool(name: keyof Tools, args: unknown, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof app.callServerTool>>> {
  const response = await fetch("/__reader", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args: args ?? {} }), signal,
  });
  if (!response.ok) throw new Error("개발 서버에서 요청을 처리하지 못했습니다.");
  return response.json();
}
export async function openLink(url: string) {
  if (standalone) { window.open(url, "_blank", "noopener,noreferrer"); return; }
  const result = await app.openLink({ url });
  if (result.isError) throw new Error("링크를 열지 못했습니다.");
}
export function interceptLink(event: MouseEvent, notify: Notify) {
  const link = event.target instanceof Element && event.target.closest<HTMLAnchorElement>("a[href]");
  if (standalone || !link || !app.getHostCapabilities()?.openLinks || !/^https?:$/.test(link.protocol)) return;
  event.preventDefault();
  openLink(link.href).catch(error => notify(error.message));
}

// A late local read must never overwrite the network response or its error state.
export async function readWithPreview<K extends "hn_feed" | "hn_story">(tool: K, args: Tools[K][0], previewArgs: PreviewArgs, onPreview: (preview: Preview<Tools[K][1]>) => void, signal?: AbortSignal) {
  let pending = true;
  call("hn_preview", previewArgs, signal).then(result => {
    if (pending) onPreview(result as Preview<Tools[K][1]>);
  }).catch(() => {}); // The live request also works without a local preview.
  try {
    return await invoke(tool, args, signal);
  } finally {
    pending = false;
  }
}

