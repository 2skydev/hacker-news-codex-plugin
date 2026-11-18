import { createContext } from "react";
import type { Translation } from "../types/reader.types.ts";

export const LanguageContext = createContext<{
  bilingual: boolean;
  toggle: () => void;
  translation: Translation;
}>({
  bilingual: false,
  toggle: () => {},
  translation: () => undefined,
});
