import { z } from "zod";
import {
  AUTO_MODEL,
  CACHE_FIELDS,
  CACHE_PERIODS,
  CACHE_RETENTION_DAYS,
} from "../shared/constants/settings.constants.ts";
import { formatCacheBytes } from "../shared/lib/format-cache-bytes.ts";
import type { Preferences, SettingsData, Tools } from "../shared/types/reader.types.ts";
import { beginSignIn, listModels, readerAccount, signOut } from "./account/account-service.ts";
import { feed, service, story, translate, watch } from "./news/news-service.ts";

const cacheFields = Object.keys(CACHE_FIELDS) as Preferences["cacheField"][];
const cachePeriods = Object.keys(CACHE_PERIODS) as Preferences["cachePeriod"][];
const settingsValues = z.object({
  model: z.string().min(1),
  realtime: z.boolean(),
  cacheField: z.enum(cacheFields),
  cachePeriod: z.enum(cachePeriods),
  cacheAutoDelete: z.boolean(),
  cacheRetentionDays: z.int().positive(),
});
const cacheStats = z.object({ count: z.int().nonnegative(), bytes: z.int().nonnegative() });
const id = z.int().positive();
const page = {
  offset: z.int().nonnegative().optional(),
  limit: z.int().positive().max(50).optional(),
};

type RegisterReaderTool = <Name extends keyof Tools, Shape extends z.ZodRawShape>(
  name: Name,
  title: string,
  schema: Shape,
  readOnly: boolean,
  run: (args: z.output<z.ZodObject<Shape>>) => Tools[Name][1] | Promise<Tools[Name][1]>,
  outputSchema?: z.ZodType,
  describe?: (data: Tools[Name][1]) => string,
) => void;

export function registerReaderTools(tool: RegisterReaderTool) {
  tool("hn_feed", "피드 읽기", { sort: z.enum(["top", "new"]), ...page }, true, feed);
  tool(
    "hn_preview",
    "저장된 번역 먼저 읽기",
    {
      sort: z.enum(["top", "new"]).optional(),
      id: id.optional(),
      offset: page.offset,
      limit: z.int().positive().max(50),
      titles: z
        .array(z.object({ id, title: z.string().max(2000) }))
        .max(20)
        .optional(),
    },
    true,
    (args) => service().preview(args),
  );
  tool(
    "hn_watch",
    "새 글 기다리기",
    {
      sort: z.enum(["top", "new"]),
      revision: z.string().regex(/^[0-9a-f]{64}$/),
    },
    true,
    watch,
  );
  tool("hn_story", "글과 댓글 읽기", { id, ...page }, true, story);
  tool(
    "hn_translate",
    "ChatGPT 구독으로 번역",
    {
      ids: z.array(id).min(1).max(50),
      field: z.enum(["title", "text"]),
    },
    false,
    translate,
  );

  tool("hn_account", "ChatGPT 연결 상태", {}, true, readerAccount);
  tool(
    "hn_connect",
    "ChatGPT 연결",
    { newAccount: z.boolean().optional(), profileId: z.string().min(1).optional() },
    false,
    beginSignIn,
  );
  tool("hn_disconnect", "ChatGPT 연결 해제", {}, false, signOut);

  const preferences = () => service().preferences;
  tool("hn_preferences", "리더 설정 읽기", {}, true, () => preferences().values());
  tool(
    "hn_clear_cache",
    "선택한 캐시 비우기",
    settingsValues.pick({ cacheField: true, cachePeriod: true }).shape,
    false,
    ({ cacheField, cachePeriod }) =>
      preferences().clear(CACHE_FIELDS[cacheField], CACHE_PERIODS[cachePeriod], Date.now()),
    undefined,
    (result) =>
      `${result.removed}개 삭제했습니다. 남은 번역 ${result.count.toLocaleString("ko")}개 (${formatCacheBytes(result.bytes)})`,
  );

  tool("hn_settings_read", "Hacker News 설정", {}, true, async (): Promise<SettingsData> => {
    const values = preferences().values();
    let models: string[] = [];
    let modelError = "";
    try {
      models = await listModels();
    } catch {
      modelError = "모델 목록을 가져오지 못했습니다. 설정을 다시 열어 주세요.";
    }
    return {
      values,
      models: [...new Set([AUTO_MODEL, ...models, values.model])],
      modelError,
      cacheFields,
      cachePeriods,
      cache: preferences().stats(),
    };
  });
  tool(
    "hn_settings_update",
    "Hacker News 설정 저장",
    {
      set: settingsValues
        .extend({ cacheRetentionDays: z.literal(CACHE_RETENTION_DAYS) })
        .partial()
        .strict()
        .refine((values) => Object.keys(values).length > 0),
    },
    false,
    async ({ set }) => {
      if (set.model && set.model !== AUTO_MODEL && !(await listModels()).includes(set.model))
        throw new Error("연결한 계정에서 사용할 수 있는 모델을 선택해 주세요.");
      return preferences().update(set);
    },
    z.object({ values: settingsValues, cache: cacheStats }),
  );
}
