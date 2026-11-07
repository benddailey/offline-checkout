import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { BACKGROUNDS, knownBackground, knownTheme, THEMES } from "./theme";

describe("themes", () => {
  it("starts on Light", () => {
    expect(THEMES[0]!.id).toBe("light");
  });

  it("falls back to Light for a saved value it doesn't know", () => {
    expect(knownTheme("dark")).toBe("dark");
    expect(knownTheme("retired-theme")).toBe("light");
    expect(knownTheme(null)).toBe("light");
  });

  it("has a block in style.css for every theme but the default", () => {
    const css = readFileSync("src/style.css", "utf8");
    for (const { id } of THEMES.slice(1)) expect(css).toContain(`[data-theme="${id}"]`);
  });
});

describe("backgrounds", () => {
  it("start on None and fall back to it for a saved value they don't know", () => {
    expect(knownBackground(null)).toBe("none");
    expect(knownBackground("retired-photo")).toBe("none");
    expect(knownBackground("shelves")).toBe("shelves");
  });

  it("have a rule in style.css", () => {
    const css = readFileSync("src/style.css", "utf8");
    for (const { id } of BACKGROUNDS.slice(1)) expect(css).toContain(`[data-background="${id}"]`);
  });
});

describe("colour classes", () => {
  it("come from theme tokens, so a theme can recolour every screen", () => {
    const palette =
      /(?<![\w-])(?:bg|text|border|divide|ring|outline|fill|stroke|accent|placeholder|shadow|decoration)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?![\w-])/g;
    const raw = globSync(["src/**/*.vue", "src/ui/classes.ts"]).flatMap((file) =>
      (readFileSync(file, "utf8").match(palette) ?? []).map((name) => `${file}: ${name}`),
    );
    expect(raw).toEqual([]);
  });
});
