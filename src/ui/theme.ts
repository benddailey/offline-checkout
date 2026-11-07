import { readonly, ref } from "vue";

/** The first is the default. Every other theme needs a matching block in style.css. */
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** The first is the default. Every one but None needs a `[data-background]` rule in style.css. */
export const BACKGROUNDS: readonly { id: string; label: string }[] = [
  { id: "none", label: "None" },
  { id: "shelves", label: "Evergreen shelves" },
];

const THEME_KEY = "oc-theme";
const BACKGROUND_KEY = "oc-background";

export function knownTheme(value: string | null): ThemeId {
  return THEMES.find((t) => t.id === value)?.id ?? THEMES[0].id;
}

export function knownBackground(value: string | null): string {
  return BACKGROUNDS.find((b) => b.id === value)?.id ?? BACKGROUNDS[0]!.id;
}

const theme = ref<ThemeId>(THEMES[0].id);
const background = ref(BACKGROUNDS[0]!.id);

export const currentTheme = readonly(theme);
export const currentBackground = readonly(background);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Blocked site data: the choice just isn't remembered.
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked site data: the choice just isn't remembered.
  }
}

function apply(themeId: ThemeId, backgroundId: string): void {
  theme.value = themeId;
  background.value = backgroundId;
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.background = backgroundId;
}

/** Run before the app mounts. localStorage rather than IndexedDB: reading it is synchronous, so the first render already has the theme. */
export function applySavedTheme(): void {
  apply(knownTheme(read(THEME_KEY)), knownBackground(read(BACKGROUND_KEY)));
}

export function setTheme(id: ThemeId): void {
  apply(id, background.value);
  write(THEME_KEY, id);
}

export function setBackground(id: string): void {
  apply(theme.value, id);
  write(BACKGROUND_KEY, id);
}
