import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_PREFERENCES } from "../shared/constants/settings.constants.ts";
import type { Preferences, Sort } from "../shared/types/reader.types.ts";
import { useAccount } from "./hooks/use-account.ts";
import { errorMessage } from "./lib/error-message.ts";
import { call, connectHost } from "./lib/host.ts";
import { ReaderPage } from "./pages/ReaderPage.tsx";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [sort, changeSort] = useState<Sort>("top");
  const [bilingual, setBilingual] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  const notify = useCallback((text: string) => {
    toast(text);
  }, []);
  const account = useAccount(ready, notify);

  useEffect(() => {
    let active = true;
    connectHost()
      .then(async () => {
        const saved = await call("hn_preferences").catch(() => DEFAULT_PREFERENCES);
        if (active) {
          setPrefs(saved);
          setReady(true);
        }
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <ReaderPage
        key={sort}
        sort={sort}
        changeSort={changeSort}
        prefs={prefs}
        onPreferences={setPrefs}
        bilingual={bilingual}
        toggleLanguage={() => setBilingual((value) => !value)}
        ready={ready}
        hostError={error}
        notify={notify}
        account={account}
      />
      <Toaster duration={6500} />
      <Toaster id="translation" position="top-right" />
    </>
  );
}
