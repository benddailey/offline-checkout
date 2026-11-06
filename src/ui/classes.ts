// A variant is complete: adding a second colour or size class beside it loses unpredictably,
// because CSS order decides, not class order. Add a variant here instead.
const base =
  "rounded-lg border-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const large = `${base} min-h-12 px-5 text-xl`;
const small = `${base} min-h-11 px-4 text-lg`;

const blue =
  "border-action-edge bg-action text-on-solid hover:bg-action-hover disabled:hover:bg-action";
const white = "border-line-5 bg-surface text-ink hover:bg-raised disabled:hover:bg-surface";
const red =
  "border-danger-edge bg-danger text-on-solid hover:bg-danger-hover disabled:hover:bg-danger";
const redOutline =
  "border-danger-line bg-surface text-danger-text-2 hover:bg-danger-tint disabled:hover:bg-surface";
const green =
  "border-success-edge bg-success text-on-solid hover:bg-success-hover disabled:hover:bg-success";

export const primary = `${large} ${blue}`;
export const secondary = `${large} ${white}`;
/** A secondary button whose section is open or whose row is selected. */
export const secondaryOn = `${large} border-accent bg-accent-soft text-ink hover:bg-accent-soft-2`;
export const danger = `${large} ${red}`;
export const dangerOutline = `${large} ${redOutline}`;
export const success = `${large} ${green}`;
export const tool = `${small} ${white}`;
export const toolPrimary = `${small} ${blue}`;
export const toolOn = `${small} border-accent bg-accent-soft text-ink hover:bg-accent-soft-2`;
export const toolDanger = `${small} ${redOutline}`;
/** Repeats on every scanned row, so it stays quiet until pointed at. */
export const rowVoid = `${base} min-h-9 border-line-3 bg-surface px-3 text-base text-ink-3 hover:border-danger-line hover:bg-danger-tint hover:text-danger-text-2 disabled:hover:border-line-3 disabled:hover:bg-surface disabled:hover:text-ink-3`;

/** Give it tabindex="-1": a click on the backdrop or text must leave focus where Esc and Tab work. */
export const dialogOverlay =
  "fixed inset-0 z-40 flex items-center justify-center bg-overlay p-6 outline-none";
/** Add a max width and a border colour. Scrolls when the window is shorter than the dialog. */
export const dialogBox =
  "flex max-h-full flex-col gap-5 overflow-y-auto rounded-xl border-4 bg-surface p-6";
/** For long dialog text: it scrolls first, so the title and the controls stay on screen. */
export const dialogText =
  "flex min-h-24 flex-col gap-3 overflow-y-auto text-xl focus-visible:outline-2 focus-visible:outline-accent";

export const field =
  "block min-h-12 w-full rounded-lg border-2 border-line-4 bg-surface px-3 text-xl focus:border-accent focus:ring-4 focus:ring-accent-ring focus:outline-none aria-invalid:border-danger-line aria-invalid:focus:border-danger-line aria-invalid:focus:ring-danger-ring";
