import type { ImportPlan, SourcePlan } from "../import/plan";
import type { ImportState } from "../log/types";
import { EXPORT_NOUNS } from "./exports";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const who = (d: { employee: string; workstation: string }) =>
  `${d.employee}${d.workstation ? ` (${d.workstation})` : ""}`;

export function sourceLine(p: SourcePlan): string {
  const parts: string[] = [];
  if (p.adds.patrons > 0 || p.adds.items > 0) {
    parts.push(`Adds ${count(p.adds.patrons, "patron")} and ${count(p.adds.items, "item")}.`);
  }
  if (p.alreadyHere > 0) parts.push(`${p.alreadyHere} already here.`);
  if (p.voidedHere > 0) parts.push(`${p.voidedHere} voided here, not added.`);
  if (p.voidedBySource > 0) parts.push(`${count(p.voidedBySource, "item")} voided in the source.`);
  return parts.join(" ");
}

export function sourceHeading(p: SourcePlan, date: (at: number) => string): string {
  const type = p.source.kind === "session" ? "Session" : EXPORT_NOUNS[p.source.format];
  const heading = `${p.source.name}: ${type}`;
  if (!p.range) return heading;
  const from = date(p.range.from);
  const to = date(p.range.to);
  return `${heading}, ${from === to ? from : `${from} to ${to}`}`;
}

export function previewWarnings(
  plan: ImportPlan,
  time: (at: number) => string,
  date: (at: number) => string,
): string[] {
  const warnings = [
    "If any of these checkouts are already in Evergreen, the new Evergreen file would check them out again.",
  ];
  const sessions = plan.sources.flatMap((p) => (p.source.kind === "session" ? [p.source] : []));
  for (const s of sessions) {
    if (!s.evergreen) continue;
    const { at } = s.evergreen;
    warnings.push(
      `${s.name} had an Evergreen download at ${time(at)} on ${date(at)} by ${who(s.evergreen)}.`,
    );
  }
  const shared = plan.alsoOnOtherPatron;
  if (shared > 0) {
    warnings.push(
      `${count(shared, "item")} ${shared === 1 ? "is" : "are"} also on another patron.`,
    );
  }
  const evergreenAdds = plan.sources.some(
    (p) =>
      p.source.kind === "file" &&
      p.source.format === "xacts" &&
      (p.adds.patrons > 0 || p.adds.items > 0),
  );
  if (evergreenAdds) {
    warnings.push(
      "An Evergreen file has no clerk or workstation, so its items count under Imported.",
    );
  }
  for (const s of sessions) {
    if (s.stillOpen) {
      warnings.push(`${s.name} is still open. Scans made there later need adding again.`);
    }
  }
  return warnings;
}

export function importLine(i: ImportState, time: (at: number) => string): string {
  return `${i.name}: ${count(i.patrons, "patron")}, ${count(i.items, "item")}, added ${time(i.at)} by ${who(i)}`;
}
