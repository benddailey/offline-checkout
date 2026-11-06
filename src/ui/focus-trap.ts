/** Keep Tab and Shift+Tab inside the dialog. */
export function trapTab(container: HTMLElement | null, e: KeyboardEvent): void {
  const items = [
    ...(container?.querySelectorAll<HTMLElement>("button:not(:disabled), input, [role=slider]") ??
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
