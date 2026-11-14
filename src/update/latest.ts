import { shallowRef } from "vue";

/** Written by .github/workflows/backgrounds.yml on every v* release: {"version":"X.Y.Z"}. */
export const LATEST_URL = "https://benddailey.github.io/offline-checkout/latest.json";
export const RELEASES_URL = "https://github.com/benddailey/offline-checkout/releases/latest";
const TIMEOUT_MS = 3000;

/** A version newer than this one, once the launch check finds it. */
export const newerVersion = shallowRef<string | null>(null);

const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);

export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  const i = a.findIndex((n, k) => n !== b[k]);
  return i !== -1 && a[i]! > b[i]!;
}

/** Never throws and never waits long: offline, blocked or odd answers all mean "nothing newer". */
export async function checkForUpdate(current = __APP_VERSION__, get = fetch): Promise<void> {
  try {
    const response = await get(LATEST_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return;
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version === "string" && isNewer(version, current)) newerVersion.value = version;
  } catch {
    // Offline is normal here.
  }
}
