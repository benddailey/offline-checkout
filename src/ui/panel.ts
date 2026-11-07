import { onBeforeUnmount, onMounted, ref, type ShallowRef } from "vue";

/** How far the clerk has dragged the screen's panel off the bookshelf, in CSS px. Shelf themes only. */
export interface Offset {
  x: number;
  y: number;
}

interface Box {
  left: number;
  right: number;
  bottom: number;
}

const STORAGE_KEY = "oc-panel";

function load(): Offset {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Offset> | null;
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y))
      return { x: saved!.x!, y: saved!.y! };
  } catch {
    // Blocked or unreadable site data: start centred.
  }
  return { x: 0, y: 0 };
}

/** Where the clerk last put the panel. The window may be too small for it right now. */
export const wanted = ref<Offset>(load());

export function savePanelOffset(offset: Offset): void {
  wanted.value = offset;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(offset));
  } catch {
    // Blocked site data: the position just isn't remembered.
  }
}

/** The space between the status bar and the panel, when the window has room for it. */
export const PANEL_GAP = 12;

/**
 * Keeps the panel inside the window, so moving it never adds scroll bars, and below the status bar
 * with a small gap. `home` is the panel's undragged box in page coordinates.
 */
export function clampOffset(want: Offset, home: Box, width: number, height: number): Offset {
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
  const room = height - home.bottom;
  return {
    x: clamp(want.x, -home.left, width - home.right),
    y: clamp(want.y, Math.min(PANEL_GAP, Math.max(0, room)), room),
  };
}

/**
 * Lets the clerk drag the screen's `<main>` panel by its own background (padding and gaps, not its
 * contents), so each library can uncover its book. Double-click the background to put it back.
 * Moves it with relative offsets rather than a transform, which would trap the panel's fixed dialogs.
 */
export function usePanelDrag(
  root: Readonly<ShallowRef<HTMLElement | null>>,
  enabled: () => boolean,
) {
  let applied: Offset = { x: 0, y: 0 };
  let observed: Element | null = null;
  const observer = new ResizeObserver(() => relayout());

  const panel = () => root.value?.querySelector<HTMLElement>("main") ?? null;

  function set(offset: Offset): void {
    applied = offset;
    root.value?.style.setProperty("--panel-x", `${offset.x}px`);
    root.value?.style.setProperty("--panel-y", `${offset.y}px`);
  }

  function relayout(): void {
    const el = panel();
    if (el !== observed) {
      if (observed) observer.unobserve(observed);
      if (el) observer.observe(el);
      observed = el;
    }
    if (!el || !enabled()) return set({ x: 0, y: 0 });
    const r = el.getBoundingClientRect();
    const home = {
      left: r.left - applied.x,
      right: r.right - applied.x,
      bottom: r.bottom + window.scrollY - applied.y,
    };
    const view = document.documentElement;
    set(clampOffset(wanted.value, home, view.clientWidth, view.clientHeight));
  }

  function onPointerDown(e: PointerEvent): void {
    const el = panel();
    if (!el || e.target !== el || e.button !== 0 || !enabled()) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, from: applied };
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      wanted.value = {
        x: start.from.x + m.clientX - start.x,
        y: start.from.y + m.clientY - start.y,
      };
      relayout();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      savePanelOffset(applied);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onDoubleClick(e: MouseEvent): void {
    if (e.target !== panel() || !enabled()) return;
    savePanelOffset({ x: 0, y: 0 });
    relayout();
  }

  onMounted(() => {
    window.addEventListener("resize", relayout);
    relayout();
  });
  onBeforeUnmount(() => {
    window.removeEventListener("resize", relayout);
    observer.disconnect();
  });

  return { relayout, onPointerDown, onDoubleClick };
}
