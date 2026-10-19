<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import MessageBanner from "../components/MessageBanner.vue";
import ScanInput from "../components/ScanInput.vue";
import SessionClosedBanner from "../components/SessionClosedBanner.vue";
import { useSession } from "../session";
import { summaryPatrons } from "../summary";

const session = useSession();

const patrons = computed(() => summaryPatrons(session.state));

const clerks = computed(() =>
  Object.keys(session.state.perClerk)
    .sort()
    .map((name) => ({ name, ...session.state.perClerk[name]! })),
);

const canGenerate = computed(() => session.state.totals.patrons > 0);

/** Which action the confirm dialog is asking about. */
const confirming = ref<"close" | "pdf" | null>(null);
const cancelButton = useTemplateRef<HTMLButtonElement>("cancel");

const missingNames = computed(() => session.notConnected.map((d) => d.employee || "Unnamed"));

const inProgress = computed(() =>
  session.othersInProgress.map((v) => `${v.patron} (${v.employee || "Unnamed"})`),
);

async function ask(what: "close" | "pdf"): Promise<void> {
  confirming.value = what;
  await nextTick();
  cancelButton.value?.focus();
}

/** Scans on an unconnected workstation would be missing from the PDF: confirm first. */
function generate(): void {
  if (session.notConnected.length > 0) void ask("pdf");
  else session.generatePdf();
}

async function confirm(): Promise<void> {
  const what = confirming.value;
  confirming.value = null;
  if (what === "pdf") session.generatePdf();
  else if (what === "close") await session.closeSession();
}

const dialog = useTemplateRef<HTMLElement>("dialog");

/** Keep Tab and Shift+Tab inside the dialog. */
function trapTab(e: KeyboardEvent): void {
  const buttons = [...(dialog.value?.querySelectorAll("button") ?? [])];
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !dialog.value?.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.value?.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** A scan made while the summary is open is recorded on the scan screen as usual. */
function onScan(code: string): void {
  session.screen = "scan";
  void session.scan(code);
}

const button =
  "min-h-12 rounded-lg border-2 px-5 text-xl font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} border-blue-800 bg-blue-700 text-white hover:bg-blue-800 disabled:hover:bg-blue-700`;
const secondary = `${button} border-slate-700 bg-white text-slate-900 hover:bg-slate-100`;
const danger = `${button} border-red-800 bg-red-700 text-white hover:bg-red-800`;
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
    <SessionClosedBanner v-if="session.closed" />

    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-3xl font-extrabold text-slate-900">Session summary</h1>
      <div class="ml-auto flex flex-wrap gap-3">
        <button
          v-if="session.closed"
          type="button"
          :class="secondary"
          @click="session.leaveSession()"
        >
          Back to start
        </button>
        <button type="button" :class="secondary" @click="session.screen = 'scan'">
          Back to scanning
        </button>
      </div>
    </div>

    <ScanInput :paused="confirming !== null" @scan="onScan" />

    <MessageBanner v-if="session.message" :message="session.message" />

    <ul
      v-if="session.notConnected.length"
      class="flex flex-col gap-1 rounded-lg border-l-8 border-amber-600 bg-amber-100 p-3 text-xl font-semibold text-amber-950"
      data-testid="not-connected"
    >
      <li v-for="d in session.notConnected" :key="d.deviceId">
        Not connected: {{ d.employee || "Unnamed" }} — their latest scans may be missing
      </li>
    </ul>

    <section class="grid gap-4 md:grid-cols-2">
      <div class="rounded-xl border-2 border-slate-300 bg-white p-5">
        <h2 class="mb-2 text-2xl font-bold">Totals</h2>
        <p class="text-xl">
          Patrons <b>{{ session.state.totals.patrons }}</b> · Items
          <b>{{ session.state.totals.items }}</b>
        </p>
        <h3 class="mt-4 mb-1 text-lg font-bold text-slate-700">By clerk</h3>
        <p v-if="clerks.length === 0" class="text-lg text-slate-600">Nothing scanned yet.</p>
        <ul v-else class="text-lg" data-testid="per-clerk">
          <li v-for="c in clerks" :key="c.name">
            {{ c.name }}: {{ c.patrons }} {{ c.patrons === 1 ? "patron" : "patrons" }},
            {{ c.items }}
            {{ c.items === 1 ? "item" : "items" }}
          </li>
        </ul>
      </div>

      <div
        class="flex flex-col items-start gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
      >
        <h2 class="text-2xl font-bold">Export</h2>
        <button
          type="button"
          :class="primary"
          :disabled="!canGenerate"
          :aria-describedby="canGenerate ? undefined : 'generate-hint'"
          @click="generate"
        >
          Generate PDF
        </button>
        <p v-if="!canGenerate" id="generate-hint" class="text-lg text-slate-600">
          Scan at least one patron first
        </p>
        <button type="button" :class="secondary" @click="session.printScannerCard()">
          Print scanner card
        </button>
        <template v-if="!session.closed">
          <h2 class="mt-2 text-2xl font-bold">End the session</h2>
          <button type="button" :class="danger" @click="ask('close')">Close session</button>
        </template>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-2xl font-bold">Patrons</h2>
      <p v-if="patrons.length === 0" class="text-lg text-slate-600">No patrons scanned yet.</p>
      <ol v-else class="flex flex-col gap-3" data-testid="summary-patrons">
        <li
          v-for="p in patrons"
          :key="p.patron"
          class="rounded-lg border-2 border-slate-300 bg-white p-4"
          data-testid="summary-patron"
        >
          <div class="flex flex-wrap items-baseline gap-x-4">
            <span
              class="font-mono text-2xl font-bold"
              :class="p.voided ? 'text-slate-400 line-through' : 'text-slate-900'"
            >
              {{ p.patron }}
            </span>
            <span v-if="p.voided" class="text-lg text-slate-500">voided</span>
            <span v-else class="text-lg text-slate-600">
              {{ p.items }} {{ p.items === 1 ? "item" : "items" }} · {{ p.clerks.join(", ") }}
            </span>
          </div>
          <ul v-if="p.rows.length" class="mt-2 flex flex-wrap gap-x-6 gap-y-1 pl-4">
            <li
              v-for="r in p.rows"
              :key="r.id"
              class="font-mono text-xl"
              :class="r.voided ? 'text-slate-400 line-through' : 'text-slate-900'"
            >
              {{ r.barcode }}
            </li>
          </ul>
        </li>
      </ol>
    </section>

    <div
      v-if="confirming"
      class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-6"
      @keydown.esc="confirming = null"
      @keydown.tab="trapTab"
    >
      <div
        ref="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        class="flex max-w-xl flex-col gap-5 rounded-xl border-4 bg-white p-6"
        :class="confirming === 'close' ? 'border-red-700' : 'border-amber-600'"
      >
        <h2 id="confirm-title" class="text-3xl font-extrabold">
          {{ confirming === "close" ? "Close session" : "Generate PDF" }}
        </h2>
        <div id="confirm-text" class="flex flex-col gap-3 text-2xl">
          <p v-if="confirming === 'close'">
            Close this session for all workstations? Scanning will stop everywhere.
          </p>
          <p v-if="confirming === 'close' && inProgress.length" data-testid="in-progress">
            Patron in progress: {{ inProgress.join(", ") }}. Their visits will stay open.
          </p>
          <p v-if="missingNames.length">
            Not connected: {{ missingNames.join(", ") }}. Their latest scans may be missing{{
              confirming === "pdf" ? " from this PDF" : ""
            }}.
          </p>
          <p v-if="confirming === 'pdf'">Generate the PDF anyway?</p>
        </div>
        <div class="flex flex-wrap gap-3">
          <button type="button" :class="confirming === 'close' ? danger : primary" @click="confirm">
            {{ confirming === "close" ? "Yes, close session" : "Generate anyway" }}
          </button>
          <button ref="cancel" type="button" :class="secondary" @click="confirming = null">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
