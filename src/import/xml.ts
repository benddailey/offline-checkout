export interface XmlHandlers {
  open(name: string, attrs: Record<string, string>): void;
  text(value: string): void;
  close(name: string): void;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e]!;
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** Just enough XML for the parts of an .xlsx: no DOCTYPE entities, no validation. */
export function scanXml(xml: string, on: XmlHandlers): void {
  const n = xml.length;
  let i = 0;
  const skipTo = (end: string, from: number) => {
    const at = xml.indexOf(end, from);
    return at === -1 ? n : at + end.length;
  };
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      on.text(decode(xml.slice(i)));
      return;
    }
    if (lt > i) on.text(decode(xml.slice(i, lt)));
    if (xml.startsWith("<!--", lt)) {
      i = skipTo("-->", lt + 4);
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      on.text(xml.slice(lt + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
    } else if (xml[lt + 1] === "?") {
      i = skipTo("?>", lt + 2);
    } else if (xml[lt + 1] === "!") {
      i = skipTo(">", lt + 2);
    } else {
      let end = lt + 1;
      let quote = "";
      for (; end < n; end++) {
        const c = xml[end]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      let body = xml.slice(lt + 1, end);
      i = end + 1;
      if (body[0] === "/") {
        on.close(local(body.slice(1).trim()));
        continue;
      }
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/]+/.exec(body)?.[0] ?? "";
      const attrs: Record<string, string> = {};
      for (const m of body
        .slice(name.length)
        .matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[local(m[1]!)] = decode(m[2] ?? m[3] ?? "");
      }
      on.open(local(name), attrs);
      if (selfClosing) on.close(local(name));
    }
  }
}
