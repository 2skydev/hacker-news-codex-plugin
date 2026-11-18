import { SettingsIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Item, Preferences, Sort } from "../../shared/types/reader.types.ts";
import { Article } from "../components/discussion/Article.tsx";
import { Feed } from "../components/feed/Feed.tsx";
import { UpdatedAt } from "../components/feed/UpdatedAt.tsx";
import { LanguageContext } from "../contexts/language-context.ts";
import type { useAccount } from "../hooks/use-account.ts";
import { useDiscussion, visibleText } from "../hooks/use-discussion.ts";
import { useFeed } from "../hooks/use-feed.ts";
import { useTranslation } from "../hooks/use-translation.ts";
import { useTranslationToast } from "../hooks/use-translation-toast.tsx";
import { interceptLink } from "../lib/host.ts";
import type { Job, Notify } from "../types/reader.types.ts";
import { SettingsPage } from "./SettingsPage.tsx";

interface ReaderPageProps {
  sort: Sort;
  changeSort: (sort: Sort) => void;
  prefs: Preferences;
  onPreferences: (values: Preferences) => void;
  account: ReturnType<typeof useAccount>;
  notify: Notify;
  ready: boolean;
  hostError: string;
  bilingual: boolean;
  toggleLanguage: () => void;
}

export function ReaderPage({
  sort,
  changeSort,
  prefs,
  onPreferences,
  account,
  notify,
  ready,
  hostError,
  bilingual,
  toggleLanguage,
}: ReaderPageProps) {
  const [settings, showSettings] = useState(false);
  const discussion = useDiscussion();
  const { thread } = discussion;
  const feed = useFeed(sort, !thread && !settings, prefs.realtime, ready);
  const gear = useRef<HTMLButtonElement>(null);
  const settingsScroll = useRef(0);
  const storyTrigger = useRef<{ element: HTMLElement; scroll: number } | null>(null);
  const jobs: Job[] = thread
    ? visibleText(thread)
    : feed.revision
      ? feed.items.map((item) => [item, "title"])
      : [];
  const { translation, progress, blocked, retry } = useTranslation(jobs, {
    enabled: !settings && !!account.session?.connected,
    session: account.session?.profileId,
    model: prefs.model,
    view: settings ? "settings" : thread ? `story-${thread.item.id}` : sort,
    onFailure: (status) => {
      if (status === "disconnected") account.refresh();
      notify(
        status === "limited"
          ? "ChatGPT 사용 한도에 도달했습니다. 설정에서 사용량을 확인할 수 있습니다."
          : status === "disconnected"
            ? "설정에서 ChatGPT 연결을 확인해 주세요."
            : "일부 글을 번역하지 못했습니다. 설정에서 다시 시도할 수 있습니다.",
      );
    },
  });

  useTranslationToast(progress, settings);

  function openStory(item: Item, element: HTMLButtonElement) {
    storyTrigger.current = { element, scroll: window.scrollY };
    discussion.open(item);
  }

  const storyId = thread?.item.id;
  useLayoutEffect(() => {
    if (storyId) {
      window.scrollTo(0, 0);
      document.getElementById("back")?.focus({ preventScroll: true });
    } else if (storyTrigger.current) {
      storyTrigger.current.element.focus({ preventScroll: true });
      window.scrollTo(0, storyTrigger.current.scroll);
      storyTrigger.current = null;
    }
  }, [storyId]);

  function toggleSettings() {
    if (!settings) {
      settingsScroll.current = window.scrollY;
      window.scrollTo(0, 0);
    }
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

  return (
    <LanguageContext.Provider value={{ bilingual, toggle: toggleLanguage, translation }}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Native links already dispatch click on keyboard activation. */}
      <main className="reader" onClick={(event) => interceptLink(event, notify)}>
        {!settings && (
          <header className="masthead">
            <div className="brand">
              <span className="mark" aria-hidden="true">
                Y
              </span>
              <h1 lang="en">Hacker News</h1>
            </div>
            <div className="masthead-actions">
              {!thread && !settings && feed.updatedAt && <UpdatedAt stamp={feed.updatedAt} />}
              <Button
                id="open-settings"
                ref={gear}
                variant="ghost"
                size="icon"
                aria-label="설정"
                title="설정"
                aria-expanded={settings}
                aria-controls="settings"
                onClick={toggleSettings}
              >
                <SettingsIcon />
              </Button>
            </div>
          </header>
        )}
        <div hidden={settings || !!thread}>
          <Feed
            feed={feed}
            sort={sort}
            changeSort={changeSort}
            open={openStory}
            hostError={hostError}
          />
        </div>
        {thread && (
          <div hidden={settings}>
            <Article
              thread={thread}
              more={discussion.more}
              toggle={discussion.toggle}
              back={discussion.close}
            />
          </div>
        )}
        {settings && (
          <SettingsPage
            account={account}
            close={toggleSettings}
            notify={notify}
            onPreferences={onPreferences}
            blocked={blocked}
            retry={retry}
          />
        )}
      </main>
    </LanguageContext.Provider>
  );
}
