import type { ObjectDirective } from "vue";

const scrollObservers = new WeakMap<HTMLElement, ResizeObserver>();

function updateScrollStop(el: HTMLElement): void {
  if (el.scrollHeight > el.clientHeight) el.setAttribute("tabindex", "0");
  else el.removeAttribute("tabindex");
}

/** A Tab stop on text only while it overflows, so a keyboard can scroll it. */
export const vScrollStop: ObjectDirective<HTMLElement> = {
  mounted(el) {
    const observer = new ResizeObserver(() => updateScrollStop(el));
    observer.observe(el);
    scrollObservers.set(el, observer);
    updateScrollStop(el);
  },
  updated: updateScrollStop,
  unmounted(el) {
    scrollObservers.get(el)?.disconnect();
  },
};

/** Keep Tab and Shift+Tab inside the dialog. */
export function trapTab(container: HTMLElement | null, e: KeyboardEvent): void {
  const items = [
    ...(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') ??
      []),
  ];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !container?.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container?.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
