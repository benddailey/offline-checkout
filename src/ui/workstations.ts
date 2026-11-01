import type { SeenWorkstation, SessionSummary } from "../store/db";

export interface OtherWorkstation extends SeenWorkstation {
  /** The session its latest named record is in. */
  sessionName: string;
}

/** Other named workstations in the open sessions, active since `since`, most recent first. */
export function otherWorkstations(sessions: SessionSummary[], since: number): OtherWorkstation[] {
  const latest = new Map<string, OtherWorkstation>();
  for (const s of sessions) {
    for (const w of s.workstations ?? []) {
      if (w.lastAt < since) continue;
      const prev = latest.get(w.deviceId);
      if (!prev || w.lastAt > prev.lastAt) latest.set(w.deviceId, { ...w, sessionName: s.name });
    }
  }
  return [...latest.values()].sort((a, b) => b.lastAt - a.lastAt);
}
