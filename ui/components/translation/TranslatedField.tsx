import { useContext } from "react";
import type { Field, Item } from "../../../shared/types/reader.types.ts";
import { LanguageContext } from "../../contexts/language-context.ts";
import { bodyContent } from "../../lib/links.ts";

function Body({ value, links }: { value: string; links?: string[] }) {
  let index = 0;
  return bodyContent(value, links || [], (label, href) => (
    <a key={index++} href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ));
}
export function TranslatedField({
  item,
  field,
  domain,
}: {
  item: Item;
  field: Field;
  domain?: string | null;
}) {
  const { bilingual, translation } = useContext(LanguageContext);
  const ko = translation(item, field),
    en = item[field];
  const render = (value: string) =>
    field === "text" ? <Body value={value} links={item.links} /> : value;
  return (
    <span lang={ko ? "ko" : "en"}>
      {render(ko || en || "")}
      {domain && (
        <>
          {" "}
          <small className="title-domain">{domain}</small>
        </>
      )}
      {bilingual && ko && en && ko !== en && (
        <span className="original" lang="en">
          {render(en)}
        </span>
      )}
    </span>
  );
}
