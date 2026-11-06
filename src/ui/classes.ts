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
export const toolDanger = `${small} ${redOutline}`;

export const field =
  "block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none";
