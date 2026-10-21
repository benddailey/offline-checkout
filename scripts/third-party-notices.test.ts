import { describe, expect, it } from "vite-plus/test";
import { embedInHtml, fillEmptySections, htmlComment } from "./third-party-notices";

describe("fillEmptySections", () => {
  const md =
    "# Licenses\n\n## a - 1.0.0 (MIT)\n\nA text\n\n## @s/b - 2.0.0 (MIT)\n\n## c - 3.0.0 (ISC)\n\nC text\n";

  it("fills a section Vite left empty and keeps the others", () => {
    const out = fillEmptySections(md, (pkg) => (pkg === "@s/b" ? "B text\n" : undefined));
    expect(out).toBe(
      "# Licenses\n\n## a - 1.0.0 (MIT)\n\nA text\n\n## @s/b - 2.0.0 (MIT)\n\nB text\n\n## c - 3.0.0 (ISC)\n\nC text\n",
    );
  });

  it("fills an empty last section", () => {
    expect(fillEmptySections("## z - 1.0.0 (MIT)\n", () => "Z text")).toBe(
      "## z - 1.0.0 (MIT)\n\nZ text\n\n",
    );
  });

  it("fails the build when no license text can be found", () => {
    expect(() => fillEmptySections(md, () => undefined)).toThrow("@s/b");
  });
});

describe("htmlComment", () => {
  it("never contains -- so the comment cannot end early", () => {
    const c = htmlComment("a --> b --!> c <!-- d ---- e");
    const body = c.slice("<!--".length, -"-->".length);
    expect(body).not.toContain("--");
    expect(c.startsWith("<!--\n")).toBe(true);
    expect(c.endsWith("\n-->")).toBe(true);
  });
});

describe("embedInHtml", () => {
  it("puts the comment after the doctype so the page stays in standards mode", () => {
    expect(embedInHtml("<!doctype html>\n<html></html>", "notice")).toBe(
      "<!doctype html>\n<!--\nnotice\n-->\n<html></html>",
    );
  });

  it("refuses HTML without a leading doctype", () => {
    expect(() => embedInHtml("<html></html>", "notice")).toThrow("doctype");
  });
});
