import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { Failure, Preferences, SettingsData } from "../../shared/types/reader.types.ts";
import { AccountSettings } from "../components/settings/AccountSettings.tsx";
import { type CacheRange, CacheSettings } from "../components/settings/CacheSettings.tsx";
import { SettingSelect } from "../components/settings/SettingSelect.tsx";
import type { useAccount } from "../hooks/use-account.ts";
import { call } from "../lib/host.ts";
import type { Notify } from "../types/reader.types.ts";

interface SettingsPageProps {
  account: ReturnType<typeof useAccount>;
  close: () => void;
  notify: Notify;
  onPreferences: (values: Preferences) => void;
  blocked: Failure | "";
  retry: () => void;
}

export function SettingsPage({
  account,
  close,
  notify,
  onPreferences,
  blocked,
  retry,
}: SettingsPageProps) {
  const { session } = account;
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [failed, setFailed] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const [range, setRange] = useState<CacheRange | null>(null);

  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh the model list when account connectivity or the reload counter changes.
  useEffect(() => {
    let active = true;
    setFailed(false);
    call("hn_settings_read")
      .then((next) => {
        if (!active) return;
        setData(next);
        if (next.modelError) notify(next.modelError);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [session?.connected, reload]);

  async function save(set: Partial<Preferences>) {
    setSaving(true);
    try {
      const { values } = await call("hn_settings_update", { set });
      setData((old) => old && { ...old, values });
      onPreferences(values);
    } catch {
      notify("설정을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!range) return;
    setSaving(true);
    try {
      const { removed, count, bytes } = await call("hn_clear_cache", range);
      setData((old) => old && { ...old, cache: { count, bytes } });
      setRange(null);
      notify(`번역 캐시 ${removed}개를 삭제했습니다.`);
    } catch {
      notify("번역 캐시를 비우지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="settings" aria-labelledby="settings-title">
      <header className="settings-header">
        <Button ref={back} variant="ghost" size="icon" aria-label="리더로 돌아가기" onClick={close}>
          <ArrowLeft />
        </Button>
        <h2 id="settings-title">설정</h2>
      </header>
      <div className="settings-sections">
        <AccountSettings account={account} blocked={blocked} retry={retry} />
        {failed && (
          <p className="empty">
            설정을 불러오지 못했습니다.{" "}
            <button type="button" className="retry" onClick={() => setReload((n) => n + 1)}>
              다시 시도
            </button>
          </p>
        )}
        {!data && !failed && (
          <p className="empty" role="status">
            설정을 불러오는 중…
          </p>
        )}
        {data && (
          <>
            <FieldSet disabled={saving}>
              <FieldLegend>리더</FieldLegend>
              <FieldGroup className="settings-group">
                <SettingSelect
                  label="번역 모델"
                  id="model"
                  choices={data.models}
                  value={data.values.model}
                  orientation="responsive"
                  disabled={saving}
                  change={(model) => save({ model })}
                />
                <Field orientation="horizontal" data-disabled={saving}>
                  <FieldContent>
                    <FieldLabel id="realtime-label" htmlFor="realtime">
                      실시간 갱신
                    </FieldLabel>
                    <FieldDescription id="realtime-description">
                      글 목록을 자동으로 갱신합니다.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="realtime"
                    name="realtime"
                    aria-labelledby="realtime-label"
                    aria-describedby="realtime-description"
                    disabled={saving}
                    checked={data.values.realtime}
                    onCheckedChange={(realtime) => save({ realtime })}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
            <CacheSettings
              data={data}
              saving={saving}
              range={range}
              onRangeChange={setRange}
              onClear={clear}
            />
          </>
        )}
      </div>
    </section>
  );
}
