import { shallowRef } from "vue";
import { PHOTO_BASE, PHOTOS, type Photo } from "./photos";

/** The photos this PC has downloaded and checked, by id. */
export const savedPhotos = shallowRef<ReadonlyMap<string, Blob>>(new Map());

const DB = "offline-checkout-backgrounds";
const STORE = "photos";

interface Saved {
  sha256: string;
  blob: Blob;
}

/** Chrome's Storage Buckets API; not in TypeScript's DOM types yet. */
interface StorageBuckets {
  open(
    name: string,
    options: { persisted: boolean; durability?: string },
  ): Promise<{ indexedDB: IDBFactory }>;
}

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/**
 * A bucket of its own, not persisted, so under disk pressure Chrome may drop the photos (they come
 * back next time the PC is online) without touching the sessions, which ask to be persisted.
 */
async function factory(): Promise<IDBFactory> {
  const buckets = (navigator as Navigator & { storageBuckets?: StorageBuckets }).storageBuckets;
  if (buckets) {
    try {
      return (await buckets.open("backgrounds", { persisted: false, durability: "relaxed" }))
        .indexedDB;
    } catch {
      // Falls back to the default bucket, beside the sessions.
    }
  }
  return indexedDB;
}

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= factory().then((f) => {
    const r = f.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    return done(r);
  });
  return db;
}

const store = async (mode: IDBTransactionMode) =>
  (await open()).transaction(STORE, mode).objectStore(STORE);

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Loads what this PC has, dropping anything no longer in PHOTOS or with a changed hash. */
export async function loadSavedPhotos(): Promise<void> {
  const s = await store("readwrite");
  const [keys, values] = await Promise.all([
    done(s.getAllKeys()),
    done(s.getAll() as IDBRequest<Saved[]>),
  ]);
  const saved = new Map<string, Blob>();
  keys.forEach((key, i) => {
    const photo = PHOTOS.find((p) => p.id === key);
    if (photo && values[i]!.sha256 === photo.sha256) saved.set(photo.id, values[i]!.blob);
    else s.delete(key);
  });
  savedPhotos.value = saved;
}

async function download(photo: Photo): Promise<void> {
  const response = await fetch(`${PHOTO_BASE}${photo.id}.webp`);
  if (!response.ok) return;
  const bytes = await response.arrayBuffer();
  if ((await sha256(bytes)) !== photo.sha256) return;
  const blob = new Blob([bytes], { type: "image/webp" });
  await done(
    (await store("readwrite")).put({ sha256: photo.sha256, blob } satisfies Saved, photo.id),
  );
  savedPhotos.value = new Map(savedPhotos.value).set(photo.id, blob);
}

/** One at a time, in the background. Offline, every fetch fails and the PC keeps what it has. */
export async function downloadMissingPhotos(): Promise<void> {
  for (const photo of PHOTOS) {
    if (savedPhotos.value.has(photo.id)) continue;
    try {
      await download(photo);
    } catch {
      // Offline, blocked or storage refused: try again at the next launch.
    }
  }
}
