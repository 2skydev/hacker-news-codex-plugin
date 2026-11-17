import { useEffect, useRef, useState } from "react";
import { ChatGPTConnectionCard } from "@siwc/react/connection-card.tsx";
import "@siwc/react/styles.css";
import { call, openLink } from "./host.js";

import type { useAccount } from "./account";
import type { Failure, Notify, Preferences, SettingsData } from "./types";
interface Props {
  account: ReturnType<typeof useAccount>; close: () => void; notify: Notify;
  onPreferences: (values: Preferences) => void; blocked: Failure | ""; retry: () => void;
}
export function Settings({ account, close, notify, onPreferences, blocked, retry }: Props) {
  const { session, busy, connect, disconnect } = account;
  const [data, setData] = useState<SettingsData | null>(null), [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0), [failed, setFailed] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let active = true;
    setFailed(false);
    call("hn_settings_read").then(next => {
      if (!active) return;
      setData(next);
      if (next.modelError) notify(next.modelError);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [session?.connected, reload]);
  async function save(set: Partial<Preferences>) {
    setSaving(true);
    try {
      const { values } = await call("hn_settings_update", { set });
      setData(old => old && ({ ...old, values }));
      onPreferences(values);
    } catch { notify("설정을 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setSaving(false); }
  }
  async function clear() {
    if (!data) return;
    setSaving(true);
    try {
      const { cacheField, cachePeriod } = data.values;
      const { removed } = await call("hn_clear_cache", { cacheField, cachePeriod });
      notify("번역 캐시 " + removed + "개를 삭제했습니다.");
      setReload(n => n + 1);
    } catch { notify("번역 캐시를 비우지 못했습니다."); }
    finally { setSaving(false); }
  }
  function select<K extends "model" | "cacheField" | "cachePeriod">(label: string, name: K, choices: Preferences[K][]) {
    return <label>{label}<select name={name} value={data?.values[name]} onChange={event => save({ [name]: event.target.value })}>
      {choices.map(value => <option key={value}>{value}</option>)}
    </select></label>;
  }
  return <section id="settings" aria-labelledby="settings-title">
    <header className="settings-header"><h2 id="settings-title">설정</h2><button ref={back} className="text-action" onClick={close}>리더로 돌아가기</button></header>
    {session && <div id="account-card" lang="en" inert={busy}>
      <ChatGPTConnectionCard status={session.status} sharing={session.sharing} identity={session.identity} appName="Hacker News"
        onConnect={connect} onDisconnect={disconnect} onManageUsage={() => openLink("https://chatgpt.com/settings/usage").catch(error => notify(error.message))} />
    </div>}
    <div id="account-actions">
      {session?.pending && <>{session.url && <a href={session.url} target="_blank" rel="noreferrer">연결 화면 다시 열기</a>}
        <button onClick={disconnect} disabled={busy}>연결 취소</button></>}
      {blocked && <button onClick={retry}>번역 다시 시도</button>}
    </div>
    {failed && <p className="empty">설정을 불러오지 못했습니다. <button className="retry" onClick={() => setReload(n => n + 1)}>다시 시도</button></p>}
    {!data && !failed && <p className="empty" role="status">설정을 불러오는 중…</p>}
    {data && <><fieldset disabled={saving}><legend>리더</legend>
      {select("번역 모델", "model", data.models)}
      <label>실시간 갱신<input name="realtime" type="checkbox" checked={data.values.realtime} onChange={event => save({ realtime: event.target.checked })} /></label>
    </fieldset><fieldset disabled={saving}><legend>번역 캐시</legend>
      {select("삭제 대상", "cacheField", data.cacheFields)}
      {select("저장 기간", "cachePeriod", data.cachePeriods)}
      <div className="cache-actions"><span id="cache-size">{data.cacheSize}</span><button className="action" onClick={clear}>선택한 캐시 비우기</button></div>
    </fieldset></>}
  </section>;
}
