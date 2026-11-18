import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Preferences, SettingsData } from "../../../shared/types/reader.types.ts";
import { SettingSelect } from "./SettingSelect.tsx";

export type CacheRange = Pick<Preferences, "cacheField" | "cachePeriod">;

interface CacheSettingsProps {
  data: SettingsData;
  saving: boolean;
  range: CacheRange | null;
  onRangeChange: (range: CacheRange | null) => void;
  onClear: () => Promise<void>;
}

export function CacheSettings({ data, saving, range, onRangeChange, onClear }: CacheSettingsProps) {
  return (
    <fieldset disabled={saving}>
      <legend>번역 캐시</legend>
      <div className="setting-row">
        <span id="cache-size">{data.cacheSize}</span>
        <Dialog
          open={range !== null}
          onOpenChange={(open) => {
            if (!saving)
              onRangeChange(
                open
                  ? {
                      cacheField: data.values.cacheField,
                      cachePeriod: data.values.cachePeriod,
                    }
                  : null,
              );
          }}
        >
          <DialogTrigger render={<Button variant="outline" />}>
            범위 선택해서 캐시 비우기
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>번역 캐시 비우기</DialogTitle>
            <DialogDescription>삭제할 번역과 저장 기간을 선택하세요.</DialogDescription>
            {range && (
              <div>
                <SettingSelect
                  label="삭제 대상"
                  id="cacheField"
                  choices={data.cacheFields}
                  value={range.cacheField}
                  disabled={saving}
                  change={(cacheField) => onRangeChange({ ...range, cacheField })}
                />
                <SettingSelect
                  label="저장 기간"
                  id="cachePeriod"
                  choices={data.cachePeriods}
                  value={range.cachePeriod}
                  disabled={saving}
                  change={(cachePeriod) => onRangeChange({ ...range, cachePeriod })}
                />
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={saving} />}>
                취소
              </DialogClose>
              <Button variant="destructive" onClick={onClear} disabled={saving}>
                선택한 캐시 비우기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </fieldset>
  );
}
