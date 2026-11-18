import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CACHE_RETENTION_DAYS } from "../../../shared/constants/settings.constants.ts";
import { formatCacheBytes } from "../../../shared/lib/format-cache-bytes.ts";
import type { Preferences, SettingsData } from "../../../shared/types/reader.types.ts";
import { AnimatedCount } from "../AnimatedCount.tsx";
import { SettingSelect } from "./SettingSelect.tsx";

export type CacheRange = Pick<Preferences, "cacheField" | "cachePeriod">;

interface CacheSettingsProps {
  data: SettingsData;
  saving: boolean;
  onSave: (set: Partial<Preferences>) => Promise<void>;
  range: CacheRange | null;
  onRangeChange: (range: CacheRange | null) => void;
  onClear: () => Promise<void>;
}

export function CacheSettings({
  data,
  saving,
  onSave,
  range,
  onRangeChange,
  onClear,
}: CacheSettingsProps) {
  const { cacheAutoDelete, cacheRetentionDays } = data.values;

  return (
    <FieldSet disabled={saving}>
      <FieldLegend>번역 캐시</FieldLegend>
      <FieldGroup className="settings-group">
        <Field orientation="horizontal" data-disabled={saving}>
          <FieldContent>
            <FieldLabel htmlFor="cacheAutoDelete">번역 캐시 자동 삭제</FieldLabel>
            <FieldDescription id="cache-auto-delete-description">
              저장된 번역을 선택한 기간 동안 보관한 뒤 삭제합니다.
            </FieldDescription>
          </FieldContent>
          <div className="flex shrink-0 items-center gap-4">
            <Select
              value={cacheRetentionDays}
              disabled={saving || !cacheAutoDelete}
              onValueChange={(days) => {
                if (days !== null) onSave({ cacheRetentionDays: days });
              }}
            >
              <SelectTrigger aria-label="보관 기간" className="min-w-16">
                <SelectValue>{cacheRetentionDays}일</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CACHE_RETENTION_DAYS.map((days) => (
                    <SelectItem key={days} value={days}>
                      {days}일
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Switch
              id="cacheAutoDelete"
              aria-describedby="cache-auto-delete-description"
              checked={cacheAutoDelete}
              disabled={saving}
              onCheckedChange={(cacheAutoDelete) => onSave({ cacheAutoDelete })}
            />
          </div>
        </Field>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>저장된 번역</FieldTitle>
            <FieldDescription>
              <AnimatedCount value={data.cache.count} />개 ({formatCacheBytes(data.cache.bytes)})
            </FieldDescription>
          </FieldContent>
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
            <DialogTrigger render={<Button variant="outline" />} disabled={saving}>
              캐시 비우기…
            </DialogTrigger>
            <DialogContent>
              <DialogHeader className="pr-8">
                <DialogTitle>번역 캐시 비우기</DialogTitle>
                <DialogDescription>삭제할 번역과 저장 기간을 선택하세요.</DialogDescription>
              </DialogHeader>
              {range && (
                <FieldGroup>
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
                </FieldGroup>
              )}
              <DialogFooter className="flex-col">
                <DialogClose render={<Button variant="outline" disabled={saving} />}>
                  취소
                </DialogClose>
                <Button variant="destructive" onClick={onClear} disabled={saving}>
                  선택한 캐시 비우기
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
