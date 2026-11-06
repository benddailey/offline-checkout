/** A session time for the screen: seconds would only be noise. */
export function dateTime(at: number): string {
  return new Date(at).toLocaleString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
