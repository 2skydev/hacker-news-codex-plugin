import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { call } from "./host.js";

import type { useAccount } from "./account";
import type { Failure, Notify, Preferences, SettingsData } from "./types";
interface Props {
  account: ReturnType<typeof useAccount>; close: () => void; notify: Notify;
  onPreferences: (values: Preferences) => void; blocked: Failure | ""; retry: () => void;
}
function Choice<Value extends string>({ label, id, value, choices, disabled, change }: {
  label: string; id: string; value: Value; choices: Value[]; disabled: boolean; change: (value: Value) => void;
}) {
  return <div className="setting-row"><label id={id + "-label"} htmlFor={id}>{label}</label>
    <Select value={value} disabled={disabled} onValueChange={next => { if (next !== null) change(next); }}>
      <SelectTrigger id={id} aria-labelledby={id + "-label"}><SelectValue /></SelectTrigger>
      <SelectContent>{choices.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
    </Select></div>;
}

type CacheRange = Pick<Preferences, "cacheField" | "cachePeriod">;

export function Settings({ account, close, notify, onPreferences, blocked, retry }: Props) {
  const { session, busy, connect, disconnect } = account;
  const [data, setData] = useState<SettingsData | null>(null), [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0), [failed, setFailed] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const [range, setRange] = useState<CacheRange | null>(null);
  const [failedPicture, setFailedPicture] = useState("");
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
    if (!range) return;
    setSaving(true);
    try {
      const { removed } = await call("hn_clear_cache", range);
      setRange(null);
      notify("번역 캐시 " + removed + "개를 삭제했습니다.");
      setReload(n => n + 1);
    } catch { notify("번역 캐시를 비우지 못했습니다."); }
    finally { setSaving(false); }
  }
  return <section id="settings" aria-labelledby="settings-title">
    <header className="settings-header"><Button ref={back} variant="ghost" size="icon" aria-label="리더로 돌아가기" onClick={close}><ArrowLeft /></Button><h2 id="settings-title">설정</h2></header>
    <fieldset disabled={busy}><legend>ChatGPT 계정</legend><div className="setting-row">
      <div className="account-summary">{session?.connected && <span className="account-avatar" aria-hidden="true">
        {session.picture && session.picture !== failedPicture ? <img src={session.picture} referrerPolicy="no-referrer" alt="" onError={() => setFailedPicture(session.picture!)} /> :
          (session.label || "ChatGPT").charAt(0).toUpperCase()}
      </span>}<div>{session?.connected ? session.label || "ChatGPT 계정" : session?.pending ? "브라우저에서 로그인 중" : "한국어 번역"}
        <p className="setting-description">{session?.connected ? "번역에 이 계정의 플랜을 사용합니다." : "ChatGPT 플랜을 연결하면 글과 댓글을 번역합니다."}</p></div></div>
      {session?.pending ? <Button variant="outline" onClick={disconnect}>연결 취소</Button> : session?.connected ?
        <Button variant="outline" onClick={disconnect}>연결 해제</Button> : <Button onClick={connect}>ChatGPT로 로그인</Button>}
    </div>
    {session?.pending && session.url && <a className="settings-link" href={session.url} target="_blank" rel="noreferrer">연결 화면 다시 열기 <ExternalLink size={14} /></a>}
    {session?.connected && <a className="settings-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">플랜 사용량 확인 <ExternalLink size={14} /></a>}
    {blocked && <Button variant="ghost" size="sm" onClick={retry}>번역 다시 시도</Button>}</fieldset>
    {failed && <p className="empty">설정을 불러오지 못했습니다. <button className="retry" onClick={() => setReload(n => n + 1)}>다시 시도</button></p>}
    {!data && !failed && <p className="empty" role="status">설정을 불러오는 중…</p>}
    {data && <><fieldset disabled={saving}><legend>리더</legend>
      <Choice label="번역 모델" id="model" choices={data.models} value={data.values.model} disabled={saving} change={model => save({ model })} />
      <div className="setting-row"><label id="realtime-label" htmlFor="realtime">실시간 갱신</label><Switch id="realtime" name="realtime" aria-labelledby="realtime-label" disabled={saving} checked={data.values.realtime} onCheckedChange={realtime => save({ realtime })} /></div>
    </fieldset><fieldset disabled={saving}><legend>번역 캐시</legend>
      <div className="setting-row"><span id="cache-size">{data.cacheSize}</span>
        <Dialog open={range !== null} onOpenChange={open => {
          if (!saving) setRange(open ? { cacheField: data.values.cacheField, cachePeriod: data.values.cachePeriod } : null);
        }}>
          <DialogTrigger render={<Button variant="outline" />}>범위 선택해서 캐시 비우기</DialogTrigger>
          <DialogContent><DialogTitle>번역 캐시 비우기</DialogTitle><DialogDescription>삭제할 번역과 저장 기간을 선택하세요.</DialogDescription>
            {range && <div>
              <Choice label="삭제 대상" id="cacheField" choices={data.cacheFields} value={range.cacheField} disabled={saving} change={cacheField => setRange({ ...range, cacheField })} />
              <Choice label="저장 기간" id="cachePeriod" choices={data.cachePeriods} value={range.cachePeriod} disabled={saving} change={cachePeriod => setRange({ ...range, cachePeriod })} />
            </div>}
            <DialogFooter><DialogClose render={<Button variant="outline" disabled={saving} />}>취소</DialogClose>
              <Button variant="destructive" onClick={clear} disabled={saving}>선택한 캐시 비우기</Button></DialogFooter>
          </DialogContent>
        </Dialog></div>
    </fieldset></>}
  </section>;
}
