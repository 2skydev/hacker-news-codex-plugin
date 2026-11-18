import type { Field, Item } from "../../shared/types/reader.types.ts";

export type Job = [Item, Field];
export type Translation = (item: Item, field: Field) => string | undefined;
export type Notify = (message: string) => void;
