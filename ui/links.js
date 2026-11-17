// Build text and anchors separately, including when the translated label moves.
export function bodyContent(text, links, external) {
  const content = document.createDocumentFragment();
  const seen = new Set();
  function appendPlain(value) {
    let cursor = 0;
    for (const match of value.matchAll(/https?:\/\/[^\s<>"'⟦⟧]+/giu)) {
      const url = match[0].replace(/[.,;!?]+$/u, '').replace(/\)$/, end =>
        (match[0].match(/\)/g)?.length ?? 0) > (match[0].match(/\(/g)?.length ?? 0) ? '' : end);
      if (!URL.canParse(url)) continue;
      content.append(value.slice(cursor, match.index), external(url, url));
      cursor = match.index + url.length;
    }
    content.append(value.slice(cursor));
  }
  let offset = 0;
  for (const match of text.matchAll(/⟦(\d+)⟧([\s\S]*?)⟦\/\1⟧/gu)) {
    const target = links[Number(match[1]) - 1];
    appendPlain(text.slice(offset, match.index));
    if (target) {
      seen.add(target);
      content.append(external(match[2] || target, target));
    } else content.append(match[2]);
    offset = match.index + match[0].length;
  }
  appendPlain(text.slice(offset).replace(/⟦\/?\d+⟧/gu, ''));
  for (const url of new Set(links)) {
    if (!seen.has(url)) content.append(' ', external(new URL(url).hostname, url));
  }
  return content;
}
