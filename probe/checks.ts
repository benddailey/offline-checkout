export type Status = "idle" | "running" | "pass" | "fail";

/** Write, read back and delete a record in a throwaway IndexedDB database. */
export async function runIndexedDbCheck(): Promise<string> {
  const name = `field-probe-${Date.now()}`;
  const request = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });

  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => open.result.createObjectStore("t");
  const db = await request(open);
  try {
    const value = `probe-${Math.random()}`;
    const write = db.transaction("t", "readwrite");
    write.objectStore("t").put(value, "k");
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve();
      write.onerror = () => reject(write.error ?? new Error("write failed"));
      write.onabort = () => reject(write.error ?? new Error("write aborted"));
    });
    const read = await request(db.transaction("t").objectStore("t").get("k"));
    if (read !== value) throw new Error("value read back did not match what was written");
    const del = db.transaction("t", "readwrite");
    del.objectStore("t").delete("k");
    await new Promise<void>((resolve, reject) => {
      del.oncomplete = () => resolve();
      del.onerror = () => reject(del.error ?? new Error("delete failed"));
    });
    const gone = await request(db.transaction("t").objectStore("t").get("k"));
    if (gone !== undefined) throw new Error("record still present after delete");
  } finally {
    db.close();
    indexedDB.deleteDatabase(name);
  }
  return "Wrote, read back and deleted a test record.";
}

/** Describe the ICE candidates in a full SDP, e.g. "host (.local name), srflx". */
export function candidateSummary(sdp: string): string {
  const kinds = new Set<string>();
  for (const line of sdp.split(/\r?\n/)) {
    const m = /^a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\S+)/.exec(line);
    if (!m) continue;
    const [, address, type] = m;
    if (type === "host") {
      kinds.add(address!.endsWith(".local") ? "host (.local name)" : "host (IP address)");
    } else {
      kinds.add(type!);
    }
  }
  return kinds.size ? [...kinds].join(", ") : "none gathered";
}

/** Resolve once ICE gathering is complete, or after timeoutMs with whatever was found. */
export function waitForGathering(pc: RTCPeerConnection, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}
