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
export function connectHost() {
  if (window.parent === window) return Promise.reject(new Error("Codex에서 Hacker News 리더를 열어 주세요."));
  return connection ??= app.connect().then(() => theme(app.getHostContext()));
}
type RequestArgs<K extends keyof Tools> = Tools[K][0] extends undefined ? [] : [args: Tools[K][0], signal?: AbortSignal];
export function call<K extends keyof Tools>(name: K, ...params: RequestArgs<K>) {
  return invoke(name, params[0], params[1]);
}
async function invoke<K extends keyof Tools>(name: K, args: Tools[K][0], signal?: AbortSignal): Promise<Tools[K][1]> {
  await connectHost();
  const result = await app.callServerTool({ name, arguments: args ?? {} }, { signal, timeout: name === "hn_translate" ? 180000 : 60000 });
  if (result.isError) throw new Error(result.content?.find(block => block.type === "text")?.text || "요청을 완료하지 못했습니다.");
  return result.structuredContent as unknown as Tools[K][1];
}
export async function openLink(url: string) {
  const result = await app.openLink({ url });
  if (result.isError) throw new Error("링크를 열지 못했습니다.");
}
export function interceptLink(event: MouseEvent, notify: Notify) {
  const link = event.target instanceof Element && event.target.closest<HTMLAnchorElement>("a[href]");
  if (!link || !app.getHostCapabilities()?.openLinks || !/^https?:$/.test(link.protocol)) return;
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

