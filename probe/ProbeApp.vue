<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { randomId } from "../src/log/ids";
import {
  PairingError,
  decodePayload,
  encodePayload,
  minifySdp,
  rebuildSdp,
} from "../src/pairing/index";
import QrDisplay from "../src/qr/QrDisplay.vue";
import QrScan from "../src/qr/QrScan.vue";
import { candidateSummary, runIndexedDbCheck, waitForGathering, type Status } from "./checks";

const CAMERA_TEST_CODE = "FIELD-PROBE-QR-OK";
const CONNECT_TIMEOUT_MS = 20_000;
const GUEST_WAIT_MS = 120_000;
const CAMERA_DECODE_TIMEOUT_MS = 60_000;
const deviceId = randomId();

function badgeClass(s: Status): string {
  return {
    idle: "bg-slate-200 text-slate-700",
    running: "bg-blue-100 text-blue-800",
    pass: "bg-green-600 text-white",
    fail: "bg-red-600 text-white",
  }[s];
}
function badgeText(s: Status): string {
  return { idle: "NOT RUN", running: "RUNNING...", pass: "PASS", fail: "FAIL" }[s];
}

// 1. IndexedDB
const idb = reactive({ status: "running" as Status, detail: "" });
onMounted(async () => {
  try {
    idb.detail = await runIndexedDbCheck();
    idb.status = "pass";
  } catch (e) {
    idb.status = "fail";
    idb.detail = describeError(e);
  }
});

// 2. Webcam
const cam = reactive({
  open: "idle" as Status,
  openDetail: "",
  scanning: false,
  decode: "idle" as Status,
  decodeDetail: "",
});
let camTimer: ReturnType<typeof setTimeout> | undefined;
async function testCamera() {
  clearTimeout(camTimer);
  cam.decodeDetail = "";
  cam.open = "running";
  cam.openDetail = "";
  cam.decode = "idle";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    cam.open = "pass";
    cam.openDetail = "The camera opened.";
    cam.scanning = true;
    cam.decode = "running";
    camTimer = setTimeout(() => {
      if (cam.decode !== "running") return;
      cam.decode = "fail";
      cam.decodeDetail =
        "No code was read. Check the camera points at the code and it is in focus.";
    }, CAMERA_DECODE_TIMEOUT_MS);
  } catch (e) {
    cam.open = "fail";
    cam.openDetail = describeError(e);
  }
}
function onCameraDecoded(text: string) {
  clearTimeout(camTimer);
  cam.decode = "pass";
  cam.decodeDetail =
    text === CAMERA_TEST_CODE ? "Read the sample code." : "Read a code (not the sample one).";
}

// 3. WebRTC
type Role = "host" | "guest";
const rtc = reactive({
  role: null as Role | null,
  status: "idle" as Status,
  step: "",
  detail: "",
  detailIsError: false,
  offerText: "",
  answerText: "",
  rttMs: null as number | null,
  candidates: "",
  prompt: "",
});
const scanner = ref<InstanceType<typeof QrScan> | null>(null);
let pc: RTCPeerConnection | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function describeError(e: unknown): string {
  if (e instanceof Error)
    return e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

function resetRtc() {
  clearTimeout(timer);
  pc?.close();
  pc = null;
  Object.assign(rtc, {
    role: null,
    status: "idle",
    step: "",
    detail: "",
    detailIsError: false,
    offerText: "",
    answerText: "",
    rttMs: null,
    candidates: "",
    prompt: "",
  });
}

function failRtc(detail: string) {
  clearTimeout(timer);
  if (rtc.status === "pass") return;
  rtc.status = "fail";
  rtc.detailIsError = true;
  rtc.detail = detail;
}

function armTimeout(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    failRtc(
      "The two PCs did not connect. The most likely cause is Windows Firewall (or security " +
        "software) blocking direct PC-to-PC traffic. Check that both PCs are on the same " +
        "network, then press Start over and try once more. If it fails again, report this " +
        "result: the connection method will not work on these PCs.",
    );
  }, ms);
}

function watchConnection(conn: RTCPeerConnection) {
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "failed") {
      failRtc("The connection failed. This is usually Windows Firewall blocking the PCs.");
    }
  };
}

function wireChannel(dc: RTCDataChannel, role: Role) {
  dc.onopen = () => {
    rtc.step = "Connected. Testing speed...";
    if (role === "host") dc.send(`ping:${performance.now()}`);
  };
  dc.onmessage = (e) => {
    const data = String(e.data);
    if (role === "guest" && data.startsWith("ping:")) {
      dc.send(`pong:${data.slice(5)}`);
      clearTimeout(timer);
      rtc.status = "pass";
      rtc.step = "Done.";
      rtc.detail = "Connected to the other PC and exchanged messages.";
    } else if (role === "host" && data.startsWith("pong:")) {
      clearTimeout(timer);
      rtc.rttMs = Math.max(1, Math.round(performance.now() - Number(data.slice(5))));
      rtc.status = "pass";
      rtc.step = "Done.";
      rtc.detail = "Connected to the other PC and exchanged messages.";
    }
  };
}

async function startHost() {
  resetRtc();
  rtc.role = "host";
  rtc.status = "running";
  rtc.step = "Preparing the code...";
  try {
    pc = new RTCPeerConnection({ iceServers: [] });
    watchConnection(pc);
    wireChannel(pc.createDataChannel("probe"), "host");
    await pc.setLocalDescription(await pc.createOffer());
    await waitForGathering(pc);
    const sdp = pc.localDescription!.sdp;
    rtc.candidates = candidateSummary(sdp);
    rtc.offerText = encodePayload({
      kind: "offer",
      sessionId: "probe",
      sessionName: "Field probe",
      deviceId,
      employee: "probe",
      sdp: minifySdp(sdp),
    });
    rtc.step =
      "Step 2: on PC B choose Guest and scan or paste this code. Then scan or paste PC B's reply below.";
  } catch (e) {
    failRtc(`Could not create the connection code. ${describeError(e)}`);
  }
}

async function onAnswer(text: string) {
  if (!pc || rtc.role !== "host" || pc.signalingState !== "have-local-offer") return;
  try {
    const answer = decodePayload(text, "answer");
    await pc.setRemoteDescription({ type: "answer", sdp: rebuildSdp(answer.sdp, "answer") });
    rtc.step = "Connecting...";
    armTimeout(CONNECT_TIMEOUT_MS);
  } catch (e) {
    rtc.detail = e instanceof PairingError ? e.message : describeError(e);
    rtc.detailIsError = true;
    scanner.value?.reset();
  }
}

function startGuest() {
  resetRtc();
  rtc.role = "guest";
  rtc.status = "running";
  rtc.step = "Scan or paste the code shown on PC A (the Host).";
}

async function onOffer(text: string) {
  if (rtc.role !== "guest" || pc) return;
  try {
    const offer = decodePayload(text, "offer");
    const conn = new RTCPeerConnection({ iceServers: [] });
    pc = conn;
    watchConnection(conn);
    conn.ondatachannel = (e) => wireChannel(e.channel, "guest");
    await conn.setRemoteDescription({ type: "offer", sdp: rebuildSdp(offer.sdp, "offer") });
    await conn.setLocalDescription(await conn.createAnswer());
    await waitForGathering(conn);
    const sdp = conn.localDescription!.sdp;
    rtc.candidates = candidateSummary(sdp);
    rtc.answerText = encodePayload({
      kind: "answer",
      sessionId: offer.sessionId,
      sessionName: offer.sessionName,
      deviceId,
      employee: "probe",
      sdp: minifySdp(sdp),
    });
    rtc.step = "Step 3: show this reply to PC A (scan it or copy and paste it). Then wait here.";
    armTimeout(GUEST_WAIT_MS);
  } catch (e) {
    pc?.close();
    pc = null;
    rtc.detail = e instanceof PairingError ? e.message : describeError(e);
    rtc.detailIsError = true;
    scanner.value?.reset();
  }
}

// Results
const copied = ref(false);
const summary = computed(() => {
  const line = (label: string, s: Status, detail: string) =>
    `${label}: ${s === "idle" || s === "running" ? "NOT COMPLETED" : badgeText(s)}${detail ? ` - ${detail}` : ""}`;
  return [
    "FIELD PROBE RESULTS",
    `Time: ${new Date().toISOString()}`,
    `Page: ${location.protocol}//`,
    `User agent: ${navigator.userAgent}`,
    `isSecureContext: ${window.isSecureContext}`,
    line("IndexedDB", idb.status, idb.detail),
    line("Camera opens", cam.open, cam.openDetail),
    line("Camera reads a QR code", cam.decode, cam.decodeDetail),
    line(
      `WebRTC (${rtc.role ?? "not started"})`,
      rtc.status,
      [rtc.rttMs !== null ? `round trip ${rtc.rttMs} ms` : "", rtc.detail]
        .filter(Boolean)
        .join("; "),
    ),
    `Candidates gathered: ${rtc.candidates || "n/a"}`,
    `Chrome asked about local network access: ${rtc.prompt || "not answered"}`,
  ].join("\n");
});
async function copyResults() {
  try {
    await navigator.clipboard.writeText(summary.value);
  } catch {
    const area = document.getElementById("results-text") as HTMLTextAreaElement | null;
    area?.select();
    document.execCommand("copy");
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-4">
    <header>
      <h1 class="text-2xl font-bold">Field probe</h1>
      <p class="text-sm text-slate-600">
        Three quick checks. Do them in order, then press "Copy results" at the bottom.
      </p>
    </header>

    <section class="rounded-lg border border-slate-300 bg-white p-4" data-testid="idb">
      <h2 class="flex items-center gap-2 text-lg font-semibold">
        1. Storage
        <span
          class="rounded px-2 py-0.5 text-sm"
          :class="badgeClass(idb.status)"
          data-testid="idb-status"
          >{{ badgeText(idb.status) }}</span
        >
      </h2>
      <p class="text-sm">{{ idb.detail }}</p>
      <p v-if="idb.status === 'fail'" class="mt-1 text-sm text-red-700">
        This browser will not let the page save data. Report this result.
      </p>
    </section>

    <section class="rounded-lg border border-slate-300 bg-white p-4" data-testid="camera">
      <h2 class="flex items-center gap-2 text-lg font-semibold">
        2. Camera
        <span class="rounded px-2 py-0.5 text-sm" :class="badgeClass(cam.open)">{{
          badgeText(cam.open)
        }}</span>
      </h2>
      <p class="text-sm">
        Press the button. If Chrome asks to use the camera, click Allow. Then point this PC's webcam
        at the sample code shown on the OTHER PC's probe page (or at a printout of it). A code on
        this PC's own screen cannot be seen by its own webcam. Scanning the connection code in step
        3 also counts as a camera read test.
      </p>
      <button
        type="button"
        class="mt-2 rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
        @click="testCamera"
      >
        Test camera
      </button>
      <p v-if="cam.openDetail" class="mt-2 text-sm">
        Camera opens: <strong>{{ badgeText(cam.open) }}</strong> {{ cam.openDetail }}
      </p>
      <p v-if="cam.open === 'fail'" class="text-sm text-red-700">
        The camera could not be used from this page. Report this result.
      </p>
      <div v-if="cam.scanning" class="mt-3 flex flex-col gap-3">
        <p class="text-sm">
          Reads a QR code: <strong>{{ badgeText(cam.decode) }}</strong> {{ cam.decodeDetail }}
        </p>
        <QrScan @decoded="onCameraDecoded" />
        <QrDisplay :text="CAMERA_TEST_CODE" label="Sample code to scan" />
      </div>
    </section>

    <section class="rounded-lg border border-slate-300 bg-white p-4" data-testid="rtc">
      <h2 class="flex items-center gap-2 text-lg font-semibold">
        3. Connect two PCs
        <span
          class="rounded px-2 py-0.5 text-sm"
          :class="badgeClass(rtc.status)"
          data-testid="rtc-status"
          >{{ badgeText(rtc.status) }}</span
        >
        <span v-if="rtc.rttMs !== null" class="text-sm font-normal" data-testid="rtc-rtt"
          >Round trip: {{ rtc.rttMs }} ms</span
        >
      </h2>
      <p class="text-sm">
        Open this page on both PCs. On the first PC press "I am PC A (Host)". On the second press "I
        am PC B (Guest)". If Chrome asks to allow access to devices on the local network, click
        Allow.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
          @click="startHost"
        >
          I am PC A (Host)
        </button>
        <button
          type="button"
          class="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
          @click="startGuest"
        >
          I am PC B (Guest)
        </button>
        <button
          v-if="rtc.role"
          type="button"
          class="rounded border border-slate-400 px-4 py-2 hover:bg-slate-100"
          @click="resetRtc"
        >
          Start over
        </button>
      </div>

      <p v-if="rtc.step" class="mt-3 font-medium" data-testid="rtc-step">{{ rtc.step }}</p>
      <p
        v-if="rtc.detail"
        role="status"
        class="mt-2 rounded p-2 text-sm"
        :class="rtc.detailIsError ? 'bg-red-100 text-red-900' : 'bg-slate-100'"
        data-testid="rtc-detail"
      >
        {{ rtc.detail }}
      </p>
      <p v-if="rtc.candidates" class="mt-2 text-sm" data-testid="rtc-candidates">
        Connection types found on this PC: {{ rtc.candidates }}
      </p>

      <div v-if="rtc.role === 'host' && rtc.offerText" class="mt-3 flex flex-col gap-3">
        <div data-testid="rtc-offer">
          <QrDisplay :text="rtc.offerText" label="Code from PC A" />
        </div>
        <div v-if="rtc.status === 'running'" data-testid="rtc-answer-in">
          <p class="mb-1 text-sm font-medium">PC B's reply goes here:</p>
          <QrScan ref="scanner" @decoded="onAnswer" />
        </div>
      </div>

      <div v-if="rtc.role === 'guest'" class="mt-3 flex flex-col gap-3">
        <div v-if="!rtc.answerText" data-testid="rtc-offer-in">
          <QrScan ref="scanner" @decoded="onOffer" />
        </div>
        <div v-else data-testid="rtc-answer">
          <QrDisplay :text="rtc.answerText" label="Reply from PC B" />
        </div>
      </div>

      <div v-if="rtc.role && rtc.status !== 'idle'" class="mt-4 text-sm">
        <p class="font-medium">Did Chrome ask about "local network" access during this test?</p>
        <div class="mt-1 flex gap-2">
          <button
            v-for="answer in ['Yes', 'No', 'Not sure']"
            :key="answer"
            type="button"
            class="rounded border px-3 py-1"
            :class="
              rtc.prompt === answer
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-400'
            "
            @click="rtc.prompt = answer"
          >
            {{ answer }}
          </button>
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-slate-300 bg-white p-4">
      <h2 class="text-lg font-semibold">Results</h2>
      <p class="text-sm">
        Press "Copy results" on each PC, then paste into an email to the project contact.
      </p>
      <textarea
        id="results-text"
        readonly
        rows="12"
        :value="summary"
        class="mt-2 w-full rounded border border-slate-300 p-2 font-mono text-xs"
      />
      <button
        type="button"
        class="mt-2 rounded bg-blue-700 px-4 py-2 text-white hover:bg-blue-600"
        @click="copyResults"
      >
        {{ copied ? "Copied" : "Copy results" }}
      </button>
    </section>
  </main>
</template>
