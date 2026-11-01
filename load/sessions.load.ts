import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { appUrl, CHROMIUM_ARGS, HEADLESS, launchChromium } from "../e2e/helpers/app";
import { pairViaPaste } from "../e2e/helpers/pair";

const RUNS = Number(process.env.LOAD_RUNS ?? 5);
const RECORDS = Number(process.env.LOAD_RECORDS ?? 10_000);
const THROTTLES = (process.env.LOAD_THROTTLE ?? "1,4").split(",").map(Number);
const OUT = resolve("test-results", "load");
const HOUR = 3_600_000;

interface Rec {
  sessionId: string;
  deviceId: string;
  seq: number;
  employee: string;
  at: number;
  type: string;
  [k: string]: unknown;
}

interface SeedSession {
  sessionId: string;
  name: string;
  employee: string;
  createdAt: number;
  closedAt?: number;
  records: Rec[];
}

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

/** About `total` records from three workstations: visits of 1-6 items, a few voids, all visits ended. */
function makeLog(o: {
  sessionId: string;
  own: string;
  start: number;
  end: number;
  total: number;
  closed: boolean;
}): Rec[] {
  const devices = [
    { id: o.own, clerks: ["Ann", "Bea"], share: 0.4 },
    { id: `peer${o.sessionId.slice(0, 5)}a`, clerks: ["Cal", "Dee"], share: 0.3 },
    { id: `peer${o.sessionId.slice(0, 5)}b`, clerks: ["Eve"], share: 0.3 },
  ];
  const out: Rec[] = [];
  for (const d of devices) {
    const n = Math.round(o.total * d.share);
    const recs: Rec[] = [];
    let seq = 0;
    const env = (type: string, body: Record<string, unknown>) => ({
      sessionId: o.sessionId,
      deviceId: d.id,
      seq: ++seq,
      employee: d.clerks[Math.floor(seq / 500) % d.clerks.length]!,
      at: 0,
      type,
      ...body,
    });
    if (d.id === o.own) recs.push(env("session-created", { name: "Outage" }));
    while (recs.length < n) {
      const visit = env("patron-started", { patron: `2${digits(13)}` });
      const visitId = `${d.id}:${visit.seq}`;
      recs.push(visit);
      const items = 1 + Math.floor(Math.random() * 6);
      for (let i = 0; i < items; i++) {
        const item = env("item-scanned", { visitId, item: `3${digits(13)}` });
        recs.push(item);
        if (Math.random() < 0.03) recs.push(env("voided", { target: `${d.id}:${item.seq}` }));
      }
      if (Math.random() < 0.01) recs.push(env("voided", { target: visitId }));
      recs.push(env("patron-ended", { visitId }));
    }
    if (o.closed && d.id === o.own) recs.push(env("session-closed", {}));
    const step = (o.end - o.start) / recs.length;
    recs.forEach((r, i) => (r.at = Math.round(o.start + i * step)));
    out.push(...recs);
  }
  return out;
}

function session(id: string, own: string, ageHours: number, closed = false): SeedSession {
  const end = Date.now() - ageHours * HOUR;
  const start = end - 8 * HOUR;
  const records = makeLog({ sessionId: id, own, start, end, total: RECORDS, closed });
  return {
    sessionId: id,
    name: `Outage ${id}`,
    employee: "Ann",
    createdAt: start,
    closedAt: closed ? end : undefined,
    records,
  };
}

const OWN = "loadtestdv";
const SCENARIOS: Record<string, () => SeedSession[]> = {
  "1 open": () => [session("sessaaaaaa", OWN, 0.2)],
  "3 open": () => [
    session("sessaaaaaa", OWN, 0.2),
    session("sessbbbbbb", OWN, 20),
    session("sesscccccc", OWN, 44),
  ],
  "3 open + 1 closed": () => [
    session("sessaaaaaa", OWN, 0.2),
    session("sessbbbbbb", OWN, 20),
    session("sesscccccc", OWN, 44),
    session("sessdddddd", OWN, 100, true),
  ],
};

/** Records when watched elements first appear, the last click and the last blob URL. */
const MARKS = `
  window.__marks = {};
  window.__lastClick = 0;
  window.__blobAt = 0;
  document.addEventListener("click", () => { window.__lastClick = performance.now(); }, true);
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blobAt = performance.now(); return create(b); };
  const watch = {
    first: '[data-testid="app-version"]',
    list: '[data-testid="resume-list"]',
    expanded: '[data-testid="resume-form"]',
    scan: '[data-testid="totals"]',
    summary: '[data-testid="summary-patrons"]',
  };
  new MutationObserver(() => {
    for (const [k, sel] of Object.entries(watch)) {
      if (!(k in window.__marks) && document.querySelector(sel)) window.__marks[k] = performance.now();
    }
  }).observe(document, { childList: true, subtree: true });
`;

declare global {
  interface Window {
    __marks: Record<string, number>;
    __lastClick: number;
    __blobAt: number;
  }
}

async function seed(page: Page, sessions: SeedSession[]): Promise<void> {
  for (const s of sessions) {
    await page.evaluate(
      async ({ s, own }) => {
        const done = (tx: IDBTransaction) =>
          new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
          });
        const open = (name: string, up: (db: IDBDatabase) => void) =>
          new Promise<IDBDatabase>((res, rej) => {
            const r = indexedDB.open(name, 1);
            r.onupgradeneeded = () => up(r.result);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
        const index = await open("offline-checkout", (db) => {
          db.createObjectStore("device");
          db.createObjectStore("sessions", { keyPath: "sessionId" });
        });
        let tx = index.transaction(["device", "sessions"], "readwrite");
        tx.objectStore("device").put(own, "id");
        const { records, ...summary } = s;
        if (summary.closedAt === undefined) delete summary.closedAt;
        tx.objectStore("sessions").put(summary);
        await done(tx);
        index.close();
        const db = await open(`oc-session-${s.sessionId}`, (db) => {
          db.createObjectStore("records", { keyPath: ["deviceId", "seq"] });
          db.createObjectStore("meta");
        });
        tx = db.transaction(["records", "meta"], "readwrite");
        const nextSeq = records.filter((r) => r.deviceId === own).length + 1;
        tx.objectStore("meta").put(
          {
            sessionId: s.sessionId,
            name: s.name,
            deviceId: own,
            employee: s.employee,
            nextSeq,
            createdAt: s.createdAt,
          },
          "meta",
        );
        for (const r of records) tx.objectStore("records").put(r);
        await done(tx);
        db.close();
      },
      { s, own: OWN },
    );
  }
}

/** listSessions' IndexedDB work, without the app around it. */
function rawListSessions(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const req = <T>(r: IDBRequest<T>) =>
      new Promise<T>((res, rej) => {
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const open = (name: string) => req(indexedDB.open(name, 1));
    const t0 = performance.now();
    const index = await open("offline-checkout");
    const all = await req(index.transaction("sessions").objectStore("sessions").getAll());
    for (const s of all) {
      if (s.closedAt !== undefined) continue;
      const db = await open(`oc-session-${s.sessionId}`);
      let closedAt: number | undefined;
      let lastAt = 0;
      for (const r of await req(db.transaction("records").objectStore("records").getAll())) {
        if (r.type === "session-closed" && (closedAt === undefined || r.at < closedAt))
          closedAt = r.at;
        if (r.at > lastAt) lastAt = r.at;
      }
      s.lastActivityAt = Math.max(s.createdAt, lastAt);
      db.close();
    }
    index.close();
    return performance.now() - t0;
  });
}

/** store.since({}) for a joiner with nothing: getAll, filter and sort. */
function rawSince(page: Page, sessionId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const req = <T>(r: IDBRequest<T>) =>
      new Promise<T>((res, rej) => {
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const db = await req(indexedDB.open(`oc-session-${id}`, 1));
    const t0 = performance.now();
    const recs = await req(db.transaction("records").objectStore("records").getAll());
    recs.sort((a, b) =>
      a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.seq - b.seq,
    );
    const ms = performance.now() - t0;
    db.close();
    return ms;
  }, sessionId);
}

async function throttle(ctx: BrowserContext, page: Page, rate: number): Promise<void> {
  if (rate === 1) return;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

const marks = (page: Page) => page.evaluate(() => window.__marks);

/** Click `name`, confirm if the not-connected dialog asks, and time until the file's blob exists. */
async function timeExport(page: Page, name: string): Promise<number> {
  await page.evaluate(() => (window.__blobAt = 0));
  await page.getByRole("button", { name, exact: true }).click();
  const anyway = page.getByRole("button", { name: /anyway$/ });
  if (await anyway.isVisible()) await anyway.click();
  await page.waitForFunction(() => window.__blobAt > 0, null, { timeout: 120_000 });
  return page.evaluate(() => window.__blobAt - window.__lastClick);
}

type Sample = Record<string, number>;

async function runOnce(profile: string, rate: number, pairing: boolean): Promise<Sample> {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: HEADLESS,
    args: CHROMIUM_ARGS,
    acceptDownloads: true,
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.addInitScript(MARKS);
    await throttle(ctx, page, rate);
    await page.goto(appUrl());
    await expect(page.getByTestId("resume-form")).toBeVisible({ timeout: 120_000 });
    const m = await marks(page);
    const out: Sample = {
      "start page: first render": m.first!,
      "start page: list shown": m.list!,
      "start page: session expanded": m.expanded!,
      "listSessions (IndexedDB only)": await rawListSessions(page),
    };

    await page.getByTestId("resume-form").getByLabel("Clerk name").fill("Load");
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(page.getByLabel("Scanner input")).toBeVisible({ timeout: 120_000 });
    out["resume: click to scan screen"] = await page.evaluate(
      () => window.__marks.scan! - window.__lastClick,
    );

    await page.getByRole("button", { name: "Summary" }).click();
    await expect(page.getByTestId("summary-patrons")).toBeVisible({ timeout: 120_000 });
    out["summary: click to shown"] = await page.evaluate(
      () => window.__marks.summary! - window.__lastClick,
    );
    out["export: PDF"] = await timeExport(page, "Generate PDF");
    out["export: CSV"] = await timeExport(page, "Download CSV");
    out["export: Excel"] = await timeExport(page, "Download Excel");
    out["export: Evergreen"] = await timeExport(page, "Download for Evergreen");

    if (pairing) {
      out["since({}) (IndexedDB + sort)"] = await rawSince(page, "sessaaaaaa");
      await page.getByRole("button", { name: "Back to scanning" }).click();
      const totals = await page.getByTestId("totals").textContent();
      const browser = await launchChromium();
      try {
        const joinerCtx = await browser.newContext();
        const joiner = await joinerCtx.newPage();
        await joiner.addInitScript(MARKS);
        await throttle(joinerCtx, joiner, rate);
        await joiner.goto(appUrl());
        await pairViaPaste(page, joiner, "Joiner");
        const done = await joiner.waitForFunction(
          (want) =>
            document.querySelector('[data-testid="totals"]')?.textContent === want
              ? performance.now()
              : 0,
          totals,
          { timeout: 300_000, polling: 50 },
        );
        out["pairing: joiner scan screen to full log"] =
          ((await done.jsonValue()) as number) - (await marks(joiner)).scan!;
      } finally {
        await browser.close();
      }
    }
    return out;
  } finally {
    await ctx.close();
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return {
    median: s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2,
    worst: s.at(-1)!,
  };
};

test.describe.configure({ mode: "serial" });

for (const [name, make] of Object.entries(SCENARIOS)) {
  test(`load: ${name}`, async () => {
    test.setTimeout(0);
    const profile = resolve(OUT, "profiles", name.replace(/\W+/g, "-"));
    await rm(profile, { recursive: true, force: true });
    await mkdir(profile, { recursive: true });
    const seeding = await chromium.launchPersistentContext(profile, {
      headless: HEADLESS,
      args: CHROMIUM_ARGS,
    });
    try {
      const page = seeding.pages()[0] ?? (await seeding.newPage());
      await page.goto(appUrl());
      await seed(page, make());
    } finally {
      await seeding.close();
    }

    const results: Record<string, Record<string, { median: number; worst: number }>> = {};
    for (const rate of THROTTLES) {
      const samples: Sample[] = [];
      for (let i = 0; i < RUNS; i++) samples.push(await runOnce(profile, rate, name === "1 open"));
      const table: Record<string, { median: number; worst: number }> = {};
      for (const key of Object.keys(samples[0]!)) table[key] = stats(samples.map((s) => s[key]!));
      results[`${rate}x CPU`] = table;
      console.log(`\n${name}, ${RECORDS} records per session, ${rate}x CPU, ${RUNS} runs (ms)`);
      console.table(
        Object.fromEntries(
          Object.entries(table).map(([k, v]) => [
            k,
            { median: Math.round(v.median), worst: Math.round(v.worst) },
          ]),
        ),
      );
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(
      resolve(OUT, `${name.replace(/\W+/g, "-")}.json`),
      JSON.stringify({ scenario: name, records: RECORDS, runs: RUNS, results }, null, 2),
    );
    await rm(profile, { recursive: true, force: true });
  });
}
