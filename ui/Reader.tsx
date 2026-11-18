import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { call, connectHost, interceptLink } from "./host";
import { useAccount } from "./account";
import { useFeed } from "./feed";
import { useDiscussion, visibleText } from "./discussion";
import { useTranslation } from "./translation";
import { Article, Feed, Language, since } from "./Stories";
import { Settings } from "./Settings";
import { errorMessage, type Item, type Job, type Notify, type Preferences, type Sort } from "./types";

const defaults: Preferences = { model: "자동", realtime: true, cacheField: "모든 번역", cachePeriod: "전체 기간" };
function UpdatedAt({ stamp }: { stamp: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const date = new Date(stamp);
  return <time id="updated-at" dateTime={date.toISOString()} title={date.toLocaleString("ko-KR")}>{since(stamp / 1000)} 갱신</time>;
}

interface ReaderProps {
  sort: Sort; changeSort: (sort: Sort) => void; prefs: Preferences; onPreferences: (values: Preferences) => void;
  account: ReturnType<typeof useAccount>; notify: Notify; ready: boolean; hostError: string;
  bilingual: boolean; toggleLanguage: () => void;
}
function Reader({ sort, changeSort, prefs, onPreferences, account, notify, ready, hostError, bilingual, toggleLanguage }: ReaderProps) {
  const [settings, showSettings] = useState(false);
  const discussion = useDiscussion();
  const { thread } = discussion;
  const feed = useFeed(sort, !thread && !settings, prefs.realtime, ready);
  const gear = useRef<HTMLButtonElement>(null), settingsScroll = useRef(0);
  const storyTrigger = useRef<{ element: HTMLElement; scroll: number } | null>(null);
  const jobs: Job[] = thread ? visibleText(thread) : feed.revision ? feed.items.map(item => [item, "title"]) : [];
  const { translation, progress, blocked, retry } = useTranslation(jobs, {
    enabled: !settings && !!account.session?.connected, session: account.session?.profileId, model: prefs.model,
    view: settings ? "settings" : thread ? "story-" + thread.item.id : sort,
    onFailure: status => {
      if (status === "disconnected") account.refresh();
      notify(status === "limited" ? "ChatGPT 사용 한도에 도달했습니다. 설정에서 사용량을 확인할 수 있습니다." :
        status === "disconnected" ? "설정에서 ChatGPT 연결을 확인해 주세요." : "일부 글을 번역하지 못했습니다. 설정에서 다시 시도할 수 있습니다.");
    },
  });

  function openStory(item: Item, element: HTMLButtonElement) {
    storyTrigger.current = { element, scroll: window.scrollY };
    discussion.open(item);
  }
  const storyId = thread?.item.id;
  useLayoutEffect(() => {
    if (storyId) { window.scrollTo(0, 0); document.getElementById("back")?.focus({ preventScroll: true }); }
    else if (storyTrigger.current) {
      storyTrigger.current.element.focus({ preventScroll: true });
      window.scrollTo(0, storyTrigger.current.scroll);
      storyTrigger.current = null;
    }
  }, [storyId]);
  function toggleSettings() {
    if (!settings) { settingsScroll.current = window.scrollY; window.scrollTo(0, 0); }
    showSettings(!settings);
  }
  const returning = useRef(false);
  useLayoutEffect(() => {
    if (!settings && returning.current) {
      gear.current?.focus({ preventScroll: true });
      window.scrollTo(0, settingsScroll.current);
    }
    returning.current = settings;
  }, [settings]);

  return <Language.Provider value={{ bilingual, toggle: toggleLanguage, translation }}>
    <main className="reader" onClick={event => interceptLink(event, notify)}>
      <header className="masthead"><div className="brand"><span className="mark" aria-hidden="true">Y</span><h1 lang="en">Hacker News</h1></div>
        <div className="masthead-actions">
          {progress && !settings && <aside id="translation-status" aria-label="한국어 번역">
            <progress id="translation-progress" aria-label="한국어 번역 진행도" max={progress.total} value={progress.done}
              style={{ "--fill": (progress.done / progress.total) + "turn" } as CSSProperties} />
            <span>번역 중 <b>{progress.done}/{progress.total}</b></span>
          </aside>}
          {!thread && !settings && feed.updatedAt && <UpdatedAt stamp={feed.updatedAt} />}
          <Button id="open-settings" ref={gear} variant="ghost" size="icon" aria-label="설정" title="설정" aria-expanded={settings} aria-controls="settings" onClick={toggleSettings}>
            <SettingsIcon />
          </Button>
        </div>
      </header>
      <div hidden={settings || !!thread}><Feed feed={feed} sort={sort} changeSort={changeSort} open={openStory} hostError={hostError} /></div>
      {thread && <div hidden={settings}><Article discussion={discussion} back={discussion.close} /></div>}
      {settings && <Settings account={account} close={toggleSettings} notify={notify} onPreferences={onPreferences} blocked={blocked} retry={retry} />}
    </main>
  </Language.Provider>;
}
export function App() {
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [sort, changeSort] = useState<Sort>("top"), [bilingual, setBilingual] = useState(false);
  const [prefs, setPrefs] = useState(defaults);
  const notify = useCallback((text: string) => { toast(text); }, []);
  const account = useAccount(ready, notify);
  useEffect(() => {
    let active = true;
    connectHost().then(async () => {
      const saved = await call("hn_preferences").catch(() => defaults);
      if (active) { setPrefs(saved); setReady(true); }
    }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, []);
  return <><Reader key={sort} sort={sort} changeSort={changeSort} prefs={prefs} onPreferences={setPrefs}
    bilingual={bilingual} toggleLanguage={() => setBilingual(value => !value)} ready={ready} hostError={error} notify={notify} account={account} />
    <Toaster duration={6500} /></>;
}
