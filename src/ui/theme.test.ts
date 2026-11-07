import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { PHOTOS } from "./backgrounds/photos";
import { sha256 } from "./backgrounds/saved";
import { knownBackground, knownTheme, THEMES } from "./theme";

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
    expect(knownBackground("loc")).toBe("loc");
  });

  it("have a rule in style.css, and photos a hash and a full credit", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain('[data-background="shelves"]');
    expect(css).toContain("[data-photo]");
    for (const p of PHOTOS) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect([p.title, p.author, p.license, p.source].every(Boolean)).toBe(true);
    }
    expect(new Set(PHOTOS.map((p) => p.id)).size).toBe(PHOTOS.length);
  });

  it("hashes downloads with SHA-256", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await sha256(abc.buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
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
