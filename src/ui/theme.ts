import { computed, readonly, ref, watch } from "vue";
import { PHOTOS } from "./backgrounds/photos";
import { savedPhotos } from "./backgrounds/saved";

/** The first is the default. Every other theme needs a matching block in style.css. */
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** The first is the default. Photos are listed only once this PC has downloaded them. */
export const BACKGROUNDS: readonly { id: string; label: string }[] = [
  { id: "none", label: "None" },
  { id: "shelves", label: "Evergreen shelves" },
  ...PHOTOS.map(({ id, label }) => ({ id, label })),
];

const isPhoto = (id: string) => PHOTOS.some((p) => p.id === id);

const THEME_KEY = "oc-theme";
const BACKGROUND_KEY = "oc-background";

export function knownTheme(value: string | null): ThemeId {
  return THEMES.find((t) => t.id === value)?.id ?? THEMES[0].id;
}

export function knownBackground(value: string | null): string {
  return BACKGROUNDS.find((b) => b.id === value)?.id ?? BACKGROUNDS[0]!.id;
}

const theme = ref<ThemeId>(THEMES[0].id);
/** What the clerk chose; a photo shows only once it is on this PC. */
const chosen = ref(BACKGROUNDS[0]!.id);

export const currentTheme = readonly(theme);
export const availableBackgrounds = computed(() =>
  BACKGROUNDS.filter((b) => !isPhoto(b.id) || savedPhotos.value.has(b.id)),
);
export const currentBackground = computed(() =>
  availableBackgrounds.value.some((b) => b.id === chosen.value) ? chosen.value : "none",
);
export const missingPhotos = computed(() => PHOTOS.length - savedPhotos.value.size);

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

let shown: { blob: Blob; url: string } | null = null;

function render(): void {
  const root = document.documentElement;
  root.dataset.theme = theme.value;
  root.dataset.background = currentBackground.value;
  const blob = savedPhotos.value.get(currentBackground.value);
  if (blob === shown?.blob) return;
  if (shown) URL.revokeObjectURL(shown.url);
  shown = blob ? { blob, url: URL.createObjectURL(blob) } : null;
  if (shown) root.style.setProperty("--photo", `url("${shown.url}")`);
  else root.style.removeProperty("--photo");
  root.toggleAttribute("data-photo", shown !== null);
}

/** Run before the app mounts. localStorage rather than IndexedDB: reading it is synchronous, so the first render already has the theme. */
export function applySavedTheme(): void {
  theme.value = knownTheme(read(THEME_KEY));
  chosen.value = knownBackground(read(BACKGROUND_KEY));
  render();
  watch([theme, currentBackground, savedPhotos], render);
}

export function setTheme(id: ThemeId): void {
  theme.value = id;
  write(THEME_KEY, id);
}

export function setBackground(id: string): void {
  chosen.value = id;
  write(BACKGROUND_KEY, id);
}
