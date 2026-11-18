import type { Item } from "../../shared/types/reader.types.ts";

export interface RawItem extends Omit<Item, "time"> {
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(value: string) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][\da-z]*);/gi, (match, name: string) => {
    if (!name.startsWith("#")) return Object.hasOwn(entities, name) ? entities[name] : match;
    const hex = name[1].toLowerCase() === "x";
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : "�";
  });
}

// HN uses HTML paragraphs, line breaks and preformatted code. Return plain text.
function plainText(html: string, links: string[]) {
  let link = 0;
  let pre = false;
  let result = "";
  for (const token of html.split(
    /(<\/?[a-z][\w-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>)/gi,
  )) {
    const tag = /^<(\/?)([a-z][\w-]*)[\s/>]/i.exec(token);
    if (tag) {
      const name = tag[2].toLowerCase();
      if (name === "a") {
        if (link) result += `⟦/${link}⟧`;
        link = 0;
        if (!tag[1]) {
          const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
          const raw = href && decodeEntities(href[1] ?? href[2] ?? href[3]);
          const url = raw && URL.parse(raw, "https://news.ycombinator.com/");
          if (url && ["https:", "http:"].includes(url.protocol)) {
            link = links.push(url.href);
            result += `⟦${link}⟧`;
          }
        }
      }
      if (name === "pre") pre = !tag[1];
      if (name === "p" || name === "pre" || name === "div") result += "\n\n";
      if (name === "br" || name === "li") result += "\n";
      continue;
    }
    const decoded = decodeEntities(token);
    result += pre ? decoded : decoded.replace(/\s+/g, " ");
  }
  return result.replace(/^\n+|\n+$/g, "");
}

export function isId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

export function cleanItem(raw: RawItem | null, id: number): Item | null {
  if (
    !raw ||
    raw.id !== id ||
    raw.dead ||
    raw.deleted ||
    !raw.type ||
    !["story", "job", "poll", "comment"].includes(raw.type)
  )
    return null;
  const item: Item = { id, type: raw.type, time: raw.time ?? 0 };
  if (typeof raw.title === "string") item.title = decodeEntities(raw.title);
  if (typeof raw.text === "string" && raw.text) {
    const links: string[] = [];
    item.text = plainText(raw.text, links);
    if (links.length) item.links = links;
  }
  if (typeof raw.url === "string" && /^https?:\/\//i.test(raw.url)) item.url = raw.url;
  if (typeof raw.by === "string") item.by = raw.by;
  if (Number.isSafeInteger(raw.score)) item.score = raw.score;
  if (Number.isSafeInteger(raw.descendants)) item.descendants = raw.descendants;
  if (Array.isArray(raw.kids)) item.kids = raw.kids.filter(isId);
  return item;
}
