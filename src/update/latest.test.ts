import { beforeEach, describe, expect, test } from "vite-plus/test";
import { checkForUpdate, isNewer, LATEST_URL, newerVersion } from "./latest";

const answer =
  (body: unknown, status = 200) =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("version check", () => {
  beforeEach(() => {
    newerVersion.value = null;
  });

  test("compares each part as a number", () => {
    expect(isNewer("0.12.1", "0.12.0")).toBe(true);
    expect(isNewer("0.13.0", "0.12.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.12.0", "0.12.0")).toBe(false);
    expect(isNewer("0.11.9", "0.12.0")).toBe(false);
    expect(isNewer("0.13", "0.12.0")).toBe(false);
    expect(isNewer("v0.13.0", "0.12.0")).toBe(false);
  });

  test("a newer published version is offered", async () => {
    let url = "";
    await checkForUpdate("0.12.0", async (u) => {
      url = u as string;
      return answer({ version: "0.12.1" })();
    });
    expect(url).toBe(LATEST_URL);
    expect(newerVersion.value).toBe("0.12.1");
  });

  test("the same or an older version offers nothing", async () => {
    await checkForUpdate("0.12.1", answer({ version: "0.12.1" }));
    await checkForUpdate("0.12.1", answer({ version: "0.12.0" }));
    expect(newerVersion.value).toBeNull();
  });

  test("offline, errors and odd answers are silent", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(checkForUpdate("0.12.0", offline)).resolves.toBeUndefined();
    await checkForUpdate("0.12.0", answer({ version: "9.9.9" }, 404));
    await checkForUpdate("0.12.0", answer("<html>not json</html>"));
    await checkForUpdate("0.12.0", answer({ version: 13 }));
    await checkForUpdate("0.12.0", answer(null));
    expect(newerVersion.value).toBeNull();
  });

  test("gives up on a slow answer", async () => {
    const start = Date.now();
    await checkForUpdate("0.12.0", (_u, init) => {
      return new Promise((_, reject) =>
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)),
      );
    });
    expect(Date.now() - start).toBeLessThan(4000);
    expect(newerVersion.value).toBeNull();
  }, 6000);
});
