import { useEffect, useRef, useState } from "react";
import type { Account, AccountSignIn } from "../../shared/types/reader.types.ts";

import { errorMessage } from "../lib/error-message.ts";
import { call, openLink } from "../lib/host.ts";
import type { Notify } from "../types/reader.types.ts";

export function useAccount(ready: boolean, notify: Notify) {
  const [session, setSession] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<Account | null>(null);
  const version = useRef(0);
  const changing = useRef(false);
  function accept(next: Account) {
    last.current = next;
    setSession(next);
  }
  async function refresh() {
    if (changing.current || document.hidden) return;
    const request = ++version.current;
    try {
      const next = await call("hn_account");
      if (version.current !== request) return;
      const before = last.current;
      accept(next);
      if (next.error && before?.error !== next.error) notify(next.error);
      else if (before?.pending && !next.pending && next.connected)
        notify("ChatGPT를 연결했습니다.");
      else if (!before && !next.connected && !next.pending)
        notify("한국어 번역은 오른쪽 위 설정에서 ChatGPT를 연결하면 시작됩니다.");
    } catch {
      if (!last.current && version.current === request)
        notify("ChatGPT 연결 상태를 확인하지 못했습니다.");
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restart polling only when the host is ready or the login polling interval changes.
  useEffect(() => {
    if (!ready) return;
    refresh();
    const timer = setInterval(refresh, session?.pending ? 1800 : 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready, session?.pending]);

  async function change(signIn?: AccountSignIn) {
    if (changing.current) return;
    version.current++;
    changing.current = true;
    setBusy(true);
    try {
      if (signIn) {
        const { url } = await call("hn_connect", signIn);
        if (URL.parse(url)?.origin !== "https://auth.openai.com")
          throw new Error("로그인 주소를 확인하지 못했습니다.");
        accept({ connected: false, ...last.current, pending: true, url });
        await openLink(url);
      } else {
        const wasPending = last.current?.pending;
        const result = await call("hn_disconnect");
        accept(result);
        notify(
          result.error ||
            (wasPending ? "ChatGPT 연결을 취소했습니다." : "ChatGPT 연결을 해제했습니다."),
        );
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      changing.current = false;
      setBusy(false);
      refresh();
    }
  }
  return {
    session,
    busy,
    refresh,
    connect: () => change({}),
    connectNew: () => change({ newAccount: true }),
    connectSaved: (profileId: string) => change({ profileId }),
    disconnect: () => change(),
  };
}
