import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { knownTheme, nextTheme, THEMES } from "./theme";

describe("themes", () => {
  it("starts on Light", () => {
    expect(THEMES[0]!.id).toBe("light");
  });

  it("cycles through every theme and back to the first", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
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
