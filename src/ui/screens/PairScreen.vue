<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { normalizeScan } from "../../log/barcode";
import { MAX_NAME } from "../../log/limits";
import type { Invite, Mesh } from "../../mesh/mesh";
import { isPairingText } from "../../pairing/chunks";
import { PairingError, type PairingPayload } from "../../pairing/payload";
import QrDisplay from "../../qr/QrDisplay.vue";
import QrScan from "../../qr/QrScan.vue";
import MessageBanner from "../components/MessageBanner.vue";
import { createScanCapture, type KeyLike } from "../scan-capture";
import { useSession, type Message } from "../session";

/** "invite": Add workstation on a machine in the session. "join": a new or isolated machine. */
const props = defineProps<{ mode: "invite" | "join" }>();

const session = useSession();

/** How long the inviter waits for the data channel once the reply code has been entered. */
const CONNECT_TIMEOUT_MS = 45_000;
/** The joiner's reply may be printed and scanned, so it waits as long as the join code lives. */
const JOIN_WAIT_MS = 300_000;

/** A join started while a session is open here is a re-pair of that session. */
const repair = props.mode === "join" && session.meta !== null;
const backTo = props.mode === "join" && !repair ? "launch" : "scan";

type Phase = "start" | "scan" | "confirm" | "name" | "working" | "answer" | "error";
const phase = ref<Phase>("start");
const error = ref("");
const status = ref("");
/** Bumped on Try again so the scanner (and its paste box) starts fresh. */
const attempt = ref(0);
let alive = true;

function errorText(err: unknown, box: "offer" | "answer"): string {
  if (err instanceof PairingError) {
    switch (err.code) {
      case "wrong-kind":
        return box === "answer"
          ? "That is a join code, not a reply code. Scan the code on the new workstation's screen after it joins."
          : "That is a reply code. Scan the code shown under Add workstation on a workstation already in the session.";
      case "malformed":
        return "That code could not be read. Try scanning again or paste the text.";
      case "old-version":
        return `That code is from a different version of Offline Checkout. This workstation has version ${__APP_VERSION__}; put the same version on both workstations.`;
      case "expired":
        return "This invitation has expired. Click Try again for a new code.";
      case "wrong-session":
        return "That code is for a different session.";
    }
  }
  // Setting up a connection fails mainly when this PC has no network address.
  return err instanceof Error ? err.message : String(err);
}

function fail(text: string): void {
  if (!alive) return;
  error.value = text;
  phase.value = "error";
}

function withTimeout<T>(p: Promise<T>, ms = CONNECT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ---- Invite (Add workstation) ----

const invite = ref<Invite | null>(null);
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;

const remainingMs = computed(() => (invite.value ? invite.value.expiresAt - now.value : 0));
const countdown = computed(() => {
  const s = Math.max(0, Math.ceil(remainingMs.value / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});

function dropInvite(): void {
  clearInterval(ticker);
  ticker = undefined;
  invite.value?.cancel();
  invite.value = null;
}

async function startInvite(): Promise<void> {
  dropInvite();
  phase.value = "start";
  const mesh = session.ensureMesh();
  if (!mesh) return fail("This workstation is not ready to add others. Click Try again.");
  try {
    const created = await mesh.createInvite();
    if (!alive) return created.cancel();
    invite.value = created;
    now.value = Date.now();
    ticker = setInterval(() => {
      now.value = Date.now();
      if (remainingMs.value <= 0 && phase.value === "scan") {
        dropInvite();
        fail(errorText(new PairingError("expired", "expired"), "answer"));
      }
    }, 1000);
    phase.value = "scan";
  } catch (err) {
    fail(errorText(err, "answer"));
  }
}

async function onAnswer(text: string): Promise<void> {
  const current = invite.value;
  if (!current || phase.value !== "scan") return;
  phase.value = "working";
  status.value = "Connecting to the new workstation…";
  try {
    const peer = await withTimeout(current.accept(text));
    if (!alive) return;
    clearInterval(ticker);
    invite.value = null;
    session.message = {
      tone: "info",
      text: `Connected to ${peer.employee || "the new workstation"}`,
    };
    session.screen = "scan";
  } catch (err) {
    dropInvite();
    fail(
      err instanceof PairingError
        ? errorText(err, "answer")
        : "The new workstation did not connect. Click Try again for a new code.",
    );
  }
}

// ---- Join ----

const offerText = ref("");
const offer = ref<PairingPayload | null>(null);
const clerk = ref(repair ? (session.meta?.employee ?? "") : "");
const clerkError = ref(false);
const answer = ref("");
/** Set while the connected mesh is being handed to the session: leaving is not allowed. */
const adopting = ref(false);
/** The joined mesh until it is handed to the session; closed if we leave or fail first. */
let pending: Mesh | null = null;

function dropPending(): void {
  pending?.close();
  pending = null;
}

function onOffer(text: string): void {
  if (phase.value !== "scan") return;
  try {
    offer.value = session.readOffer(text);
    offerText.value = text;
    phase.value = "confirm";
  } catch (err) {
    fail(errorText(err, "offer"));
  }
}

async function submitName(): Promise<void> {
  const name = clerk.value.trim();
  clerkError.value = name === "";
  if (clerkError.value || phase.value !== "name") return;
  phase.value = "working";
  status.value = "Preparing the reply code…";
  let joined: Awaited<ReturnType<typeof session.joinSession>>;
  try {
    joined = await session.joinSession(offerText.value, name);
  } catch (err) {
    return fail(errorText(err, "offer"));
  }
  if (!alive) return joined.mesh.close();
  pending = joined.mesh;
  answer.value = joined.answer;
  phase.value = "answer";
  try {
    await withTimeout(joined.connected, JOIN_WAIT_MS);
  } catch (err) {
    if (pending !== joined.mesh) return;
    dropPending();
    return fail(
      err instanceof PairingError
        ? errorText(err, "offer")
        : "Could not connect. The join code may have expired. Click Try again and scan a new code from Add workstation.",
    );
  }
  if (pending !== joined.mesh || !alive) return;
  pending = null;
  phase.value = "working";
  status.value = "Opening the session…";
  adopting.value = true;
  try {
    if (!(await session.adoptJoinedSession(joined.offer, name, joined.mesh))) {
      fail("Could not open the session on this workstation. Click Try again.");
    }
  } catch (err) {
    console.error("pair: could not adopt the joined session", err);
    if (session.mesh !== joined.mesh) joined.mesh.close();
    fail("Could not open the session on this workstation. Click Try again.");
  } finally {
    adopting.value = false;
  }
}

function startJoin(): void {
  dropPending();
  offer.value = null;
  offerText.value = "";
  answer.value = "";
  phase.value = "scan";
}

// ---- Scans while pairing ----

/** Outcome of the last scan made on this screen (recorded in the open session). */
const scanNote = ref<Message | null>(null);

const scanner = useTemplateRef<InstanceType<typeof QrScan>>("scanner");

/**
 * A scanner used while this screen is up still records into the open session, except printed
 * pairing barcodes: those go to the code reader (raw, case kept), or nowhere if none is shown.
 */
const capture = createScanCapture((code) => {
  if (isPairingText(code)) scanner.value?.acceptScan(code);
  else if (session.meta) void recordScan(code);
});

function onKeydown(e: KeyboardEvent): void {
  if (session.meta || scanner.value) capture(e as KeyLike);
}

async function recordScan(code: string): Promise<void> {
  session.message = null;
  await session.scan(code);
  if (!alive) return;
  // A patron is checked out on the scan screen, never behind a pairing code.
  if (session.lockedPatron) {
    session.screen = "scan";
    return;
  }
  scanNote.value = session.message ?? {
    tone: "info",
    text: `Scan recorded: ${normalizeScan(code)}`,
  };
}

// ---- Common ----

function tryAgain(): void {
  error.value = "";
  attempt.value++;
  if (props.mode === "invite") void startInvite();
  else startJoin();
}

function leave(): void {
  if (adopting.value) return;
  session.screen = backTo;
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
  if (props.mode === "invite") void startInvite();
  else startJoin();
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown, true);
  alive = false;
  dropInvite();
  dropPending();
});

const title =
  props.mode === "invite"
    ? "Add workstation"
    : repair
      ? "Re-pair this workstation"
      : "Join session";

const field =
  "block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none";
const primary =
  "min-h-12 rounded-lg border-2 border-blue-800 bg-blue-700 px-6 text-xl font-semibold text-white hover:bg-blue-800";
const secondary =
  "min-h-12 rounded-lg border-2 border-slate-700 bg-white px-6 text-xl font-semibold text-slate-900 hover:bg-slate-100";
const step = "text-2xl font-bold text-slate-900";
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-3xl font-extrabold text-slate-900">{{ title }}</h1>
      <button v-if="!adopting" type="button" :class="[secondary, 'ml-auto']" @click="leave">
        Back
      </button>
    </div>

    <MessageBanner v-if="scanNote" :message="scanNote" />

    <p v-if="phase === 'start'" class="text-xl text-slate-700">Preparing the join code…</p>

    <div v-else-if="phase === 'error'" class="flex flex-col items-start gap-4">
      <p
        role="alert"
        class="rounded-lg border-l-8 border-red-700 bg-red-100 p-4 text-2xl font-semibold text-red-900"
      >
        {{ error }}
      </p>
      <button type="button" :class="primary" @click="tryAgain">Try again</button>
    </div>

    <p v-else-if="phase === 'working'" class="text-xl text-slate-700" role="status">
      {{ status }}
    </p>

    <!-- Invite: show the join code, then scan the reply code. -->
    <div v-else-if="mode === 'invite' && invite" class="grid gap-6 md:grid-cols-2">
      <section class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5">
        <h2 :class="step">1. On the new workstation, click Join session and scan this code</h2>
        <QrDisplay
          :text="invite.payload"
          label="Join code"
          :session-name="session.meta?.name"
          :expires-at="invite.expiresAt"
        />
        <p class="text-lg text-slate-700" data-testid="countdown">
          Expires in <span class="font-mono font-bold">{{ countdown }}</span>
        </p>
      </section>
      <section class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5">
        <h2 :class="step">2. Scan the reply code shown on the new workstation</h2>
        <QrScan ref="scanner" :key="attempt" @decoded="onAnswer" />
      </section>
    </div>

    <!-- Join: scan the join code. -->
    <section
      v-else-if="phase === 'scan'"
      class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
    >
      <h2 :class="step">
        Scan the join code shown under Add workstation on a workstation already in the session
      </h2>
      <QrScan ref="scanner" :key="attempt" @decoded="onOffer" />
    </section>

    <section
      v-else-if="phase === 'confirm' && offer"
      class="flex flex-col items-start gap-4 rounded-xl border-2 border-slate-300 bg-white p-5"
    >
      <h2 class="text-3xl font-bold">Join {{ offer.sessionName }}?</h2>
      <p class="text-xl text-slate-700">
        Invited by {{ offer.employee || "another workstation" }}.
      </p>
      <div class="flex gap-3">
        <button type="button" :class="primary" @click="phase = 'name'">Join</button>
        <button type="button" :class="secondary" @click="tryAgain">Scan a different code</button>
      </div>
    </section>

    <form
      v-else-if="phase === 'name'"
      class="flex max-w-xl flex-col gap-4 rounded-xl border-2 border-slate-300 bg-white p-5"
      @submit.prevent="submitName"
    >
      <h2 :class="step">Who is working at this workstation?</h2>
      <label class="flex flex-col gap-1 text-lg font-semibold">
        Clerk name
        <input
          v-model="clerk"
          :class="field"
          type="text"
          autocomplete="off"
          :maxlength="MAX_NAME"
          :aria-invalid="clerkError"
          aria-describedby="join-clerk-error"
        />
      </label>
      <p v-if="clerkError" id="join-clerk-error" class="text-lg font-semibold text-red-700">
        Enter your name to join.
      </p>
      <button type="submit" :class="[primary, 'self-start']">Continue</button>
    </form>

    <section
      v-else-if="phase === 'answer'"
      class="flex max-w-xl flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
    >
      <h2 :class="step">
        On {{ offer?.employee || "the other" }}'s workstation, scan this reply code
      </h2>
      <QrDisplay :text="answer" label="Reply code" :session-name="offer?.sessionName" />
      <p class="text-lg text-slate-700" role="status">Waiting for the other workstation…</p>
    </section>
  </main>
</template>
