import { readonly, ref } from "vue";

/** The first is the default. Every other theme needs a matching block in style.css. */
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "shelf-light", label: "Shelf light" },
  { id: "shelf-dark", label: "Shelf dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "oc-theme";

export function knownTheme(value: string | null): ThemeId {
  return THEMES.find((t) => t.id === value)?.id ?? THEMES[0].id;
}

const current = ref<ThemeId>(THEMES[0].id);

export const currentTheme = readonly(current);

function apply(id: ThemeId): void {
  current.value = id;
  document.documentElement.dataset.theme = id;
}

/** Run before the app mounts. localStorage rather than IndexedDB: reading it is synchronous, so the first render already has the theme. */
export function applySavedTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked site data: the theme just isn't remembered.
  }
  apply(knownTheme(saved));
}

export function setTheme(id: ThemeId): void {
  apply(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Blocked site data: the theme just isn't remembered.
  }
}
