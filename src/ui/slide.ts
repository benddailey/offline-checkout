export const SLIDE_STEP = 20;
const RELEASE_SLACK_PX = 8;

export function slideKey(value: number, key: string): { value: number; confirm: boolean } | null {
  let next: number;
  if (key === "ArrowRight" || key === "ArrowUp") next = value + SLIDE_STEP;
  else if (key === "ArrowLeft" || key === "ArrowDown") next = value - SLIDE_STEP;
  else if (key === "Home") next = 0;
  else if (key === "End") next = 100;
  else return null;
  next = Math.min(100, Math.max(0, next));
  return { value: next, confirm: next === 100 && value < 100 };
}

export function slideRelease(px: number, trackPx: number): boolean {
  return px >= trackPx - RELEASE_SLACK_PX;
}
