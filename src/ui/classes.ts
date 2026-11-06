// A variant is complete: adding a second colour or size class beside it loses unpredictably,
// because CSS order decides, not class order. Add a variant here instead.
const base =
  "rounded-lg border-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
const large = `${base} min-h-12 px-5 text-xl`;
const small = `${base} min-h-11 px-4 text-lg`;

const blue = "border-blue-800 bg-blue-700 text-white hover:bg-blue-800 disabled:hover:bg-blue-700";
const white = "border-slate-700 bg-white text-slate-900 hover:bg-slate-100 disabled:hover:bg-white";
const red = "border-red-800 bg-red-700 text-white hover:bg-red-800 disabled:hover:bg-red-700";
const redOutline = "border-red-700 bg-white text-red-800 hover:bg-red-50 disabled:hover:bg-white";
const green =
  "border-green-800 bg-green-700 text-white hover:bg-green-800 disabled:hover:bg-green-700";

export const primary = `${large} ${blue}`;
export const secondary = `${large} ${white}`;
/** A secondary button whose section is open or whose row is selected. */
export const secondaryOn = `${large} border-blue-700 bg-blue-50 text-slate-900 hover:bg-blue-100`;
export const danger = `${large} ${red}`;
export const dangerOutline = `${large} ${redOutline}`;
export const success = `${large} ${green}`;
export const tool = `${small} ${white}`;
export const toolPrimary = `${small} ${blue}`;
export const toolOn = `${small} border-blue-700 bg-blue-50 text-slate-900 hover:bg-blue-100`;
export const toolDanger = `${small} ${redOutline}`;
/** Repeats on every scanned row, so it stays quiet until pointed at. */
export const rowVoid = `${base} min-h-9 border-slate-400 bg-white px-3 text-base text-slate-700 hover:border-red-700 hover:bg-red-50 hover:text-red-800 disabled:hover:border-slate-400 disabled:hover:bg-white disabled:hover:text-slate-700`;

export const dialogOverlay =
  "fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-6";
/** Add a max width and a border colour. Scrolls when the window is shorter than the dialog. */
export const dialogBox =
  "flex max-h-full flex-col gap-5 overflow-y-auto rounded-xl border-4 bg-white p-6";
/** For long dialog text: it scrolls first, so the title and the controls stay on screen. */
export const dialogText =
  "flex min-h-24 flex-col gap-3 overflow-y-auto text-2xl focus-visible:outline-2 focus-visible:outline-blue-700";

export const field =
  "block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none aria-invalid:border-red-700 aria-invalid:focus:border-red-700 aria-invalid:focus:ring-red-300";
