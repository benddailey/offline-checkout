<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import AddToSession from "../components/AddToSession.vue";
import MessageBanner from "../components/MessageBanner.vue";
import ScanInput from "../components/ScanInput.vue";
import SessionClosedBanner from "../components/SessionClosedBanner.vue";
import SlideToConfirm from "../components/SlideToConfirm.vue";
import {
  danger,
  dialogBox,
  dialogOverlay,
  dialogText,
  primary,
  secondary,
  tool,
  toolPrimary,
} from "../classes";
import { evergreenStale, exportLines } from "../exports";
import { trapTab, vScrollStop } from "../focus-trap";
import { useSession } from "../session";
import { summaryPatrons } from "../summary";
import { hasWorkstations, workstationLabel } from "../../log/reduce";

const session = useSession();
const version = __APP_VERSION__;

const patrons = computed(() => summaryPatrons(session.state));

const clerks = computed(() =>
  Object.keys(session.state.perClerk)
    .sort()
    .map((name) => ({ name, ...session.state.perClerk[name]! })),
);

const canGenerate = computed(() => session.state.totals.patrons > 0);
const hasItems = computed(() => session.state.totals.items > 0);

type ExportKind = "pdf" | "csv" | "xlsx" | "xacts";

const EXPORTS: Record<ExportKind, { action: string; verb: string; noun: string }> = {
  pdf: { action: "Generate PDF", verb: "Generate", noun: "PDF" },
  csv: { action: "Download CSV", verb: "Download", noun: "CSV file" },
  xlsx: { action: "Download Excel", verb: "Download", noun: "Excel file" },
  xacts: { action: "Download for Evergreen", verb: "Download", noun: "Evergreen file" },
};

/** Which action the confirm dialog is asking about. */
const confirming = ref<"close" | "delete" | ExportKind | null>(null);
const confirmingExport = computed(() =>
  confirming.value && confirming.value !== "close" && confirming.value !== "delete"
    ? EXPORTS[confirming.value]
    : null,
);
const cancelButton = useTemplateRef<HTMLButtonElement>("cancel");

const workstations = computed(() =>
  hasWorkstations(session.state)
    ? Object.entries(session.state.perWorkstation).map(([w, n]) => ({
        name: workstationLabel(w),
        ...n,
      }))
    : [],
);

/** "Ann (Front desk 2)": the clerk, and the workstation when its records name one. */
const who = (d: { employee: string; workstation: string }) =>
  `${d.employee || "Unnamed"}${d.workstation ? ` (${d.workstation})` : ""}`;

const missingNames = computed(() => session.notConnected.map(who));

const exportSummary = computed(() =>
  exportLines(session.state.exports, (at) =>
    new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  ),
);
const evergreenStaleNow = computed(() => evergreenStale(session.state));
const evergreenExported = computed(
  () => session.state.exports.some((e) => e.kind === "xacts") && !evergreenStaleNow.value,
);

const inProgress = computed(() =>
  session.othersInProgress.map((v) => `${v.patron} (${v.employee || "Unnamed"})`),
);

async function ask(what: "close" | "delete" | ExportKind): Promise<void> {
  confirming.value = what;
  await nextTick();
  cancelButton.value?.focus();
}

function runExport(kind: ExportKind): void {
  if (kind === "pdf") session.generatePdf();
  else session.exportTable(kind);
}

/** Scans on an unconnected workstation would be missing from the export: confirm first. */
function exportSession(kind: ExportKind): void {
  if (session.notConnected.length > 0) void ask(kind);
  else runExport(kind);
}

async function confirm(): Promise<void> {
  const what = confirming.value;
  if (what === "delete") {
    await session.deleteSession();
    confirming.value = null;
    return;
  }
  confirming.value = null;
  if (what === "close") await session.closeSession();
  else if (what) runExport(what);
}

const dialog = useTemplateRef<HTMLElement>("dialog");

function dismiss(): void {
  if (!session.deletingSession) confirming.value = null;
}

/** A scan made while the summary is open is recorded on the scan screen as usual. */
function onScan(code: string): void {
  session.screen = "scan";
  void session.scan(code);
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-4">
    <SessionClosedBanner v-if="session.closed" />

    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-3xl font-extrabold text-slate-900">Session summary</h1>
      <span class="text-lg text-slate-600" data-testid="app-version">Version {{ version }}</span>
      <div class="ml-auto flex flex-wrap gap-3">
        <button type="button" :class="secondary" @click="session.screen = 'scan'">
          Back to scanning
        </button>
      </div>
    </div>

    <ScanInput quiet :paused="confirming !== null || session.toolbarDialog" @scan="onScan" />

    <MessageBanner v-if="session.message" :message="session.message" />

    <ul
      v-if="session.notConnected.length"
      class="flex flex-col gap-1 rounded-lg border-l-8 border-amber-600 bg-amber-100 p-3 text-xl font-semibold text-amber-950"
      data-testid="not-connected"
    >
      <li v-for="d in session.notConnected" :key="d.deviceId">
        Not connected: {{ who(d) }} — their latest scans may be missing
      </li>
    </ul>

    <div class="grid items-start gap-4 md:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-4">
        <section class="rounded-xl border-2 border-slate-300 bg-white p-5">
          <h2 class="mb-2 text-xl font-bold">Totals</h2>
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
          <template v-if="workstations.length">
            <h3 class="mt-4 mb-1 text-lg font-bold text-slate-700">By workstation</h3>
            <ul class="text-lg" data-testid="per-workstation">
              <li v-for="w in workstations" :key="w.name">
                {{ w.name }}: {{ w.patrons }} {{ w.patrons === 1 ? "patron" : "patrons" }},
                {{ w.items }}
                {{ w.items === 1 ? "item" : "items" }}
              </li>
            </ul>
          </template>
        </section>

        <section class="flex flex-col gap-3">
          <h2 class="text-xl font-bold">Patrons</h2>
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
                  :class="p.voided ? 'text-slate-500 line-through' : 'text-slate-900'"
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
                  :class="r.voided ? 'text-slate-500 line-through' : 'text-slate-900'"
                >
                  {{ r.barcode }}
                </li>
              </ul>
            </li>
          </ol>
        </section>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <section
          class="flex flex-col items-start gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
        >
          <h2 class="text-xl font-bold">Export</h2>
          <button
            type="button"
            :class="toolPrimary"
            :disabled="!canGenerate"
            :aria-describedby="canGenerate ? undefined : 'generate-hint'"
            @click="exportSession('pdf')"
          >
            Generate PDF
          </button>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              :class="tool"
              :disabled="!canGenerate"
              :aria-describedby="canGenerate ? undefined : 'generate-hint'"
              @click="exportSession('csv')"
            >
              Download CSV
            </button>
            <button
              type="button"
              :class="tool"
              :disabled="!canGenerate"
              :aria-describedby="canGenerate ? undefined : 'generate-hint'"
              @click="exportSession('xlsx')"
            >
              Download Excel
            </button>
            <button
              type="button"
              :class="tool"
              :disabled="!hasItems"
              :aria-describedby="hasItems ? undefined : 'generate-hint'"
              @click="exportSession('xacts')"
            >
              Download for Evergreen
            </button>
          </div>
          <p v-if="!canGenerate" id="generate-hint" class="text-lg text-slate-600">
            Scan at least one patron first
          </p>
          <p v-else-if="!hasItems" id="generate-hint" class="text-lg text-slate-600">
            Scan at least one item to download for Evergreen
          </p>
          <p
            v-if="evergreenStaleNow"
            data-testid="evergreen-stale"
            class="text-lg font-semibold text-red-800"
          >
            Items were added after the last Evergreen download. The new file contains every checkout
            in the session, so upload only one of them unless the earlier one was never uploaded.
          </p>
          <h2 class="mt-1 text-xl font-bold">Scanner card</h2>
          <div class="flex flex-wrap gap-2">
            <button type="button" :class="tool" @click="session.printScannerCard('receipt')">
              Receipt printer
            </button>
            <button type="button" :class="tool" @click="session.printScannerCard('letter')">
              Letter PDF
            </button>
          </div>
          <template v-if="!session.closed">
            <h2 class="mt-1 text-xl font-bold">End the session</h2>
            <button type="button" :class="danger" @click="ask('close')">Close session</button>
          </template>
          <template v-else>
            <h2 class="mt-1 text-xl font-bold">Delete session</h2>
            <button type="button" :class="danger" @click="ask('delete')">Delete session</button>
          </template>
        </section>

        <AddToSession />
      </div>
    </div>

    <div
      v-if="confirming"
      :class="dialogOverlay"
      @keydown.esc="dismiss"
      @keydown.tab="trapTab(dialog, $event)"
    >
      <div
        ref="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        :class="[
          dialogBox,
          'max-w-xl',
          confirming === 'close' || confirming === 'delete' ? 'border-red-700' : 'border-amber-600',
        ]"
      >
        <h2 id="confirm-title" class="text-3xl font-extrabold">
          {{
            confirming === "delete"
              ? "Delete session"
              : (confirmingExport?.action ?? "Close session")
          }}
        </h2>
        <div id="confirm-text" v-scroll-stop :class="dialogText">
          <p v-if="confirming === 'close'">
            Close this session for all workstations? Scanning will stop everywhere. This can't be
            undone. Stopping for the day? Use <strong>Exit session</strong> instead, and resume
            tomorrow.
          </p>
          <p v-if="confirming === 'close' && inProgress.length" data-testid="in-progress">
            Patron in progress: {{ inProgress.join(", ") }}. Their visits will stay open.
          </p>
          <template v-if="confirming === 'delete'">
            <p v-if="!evergreenExported" class="font-semibold text-red-800">
              Download the Evergreen file first if these checkouts are not in Evergreen yet.
            </p>
            <p>
              This removes the session from this workstation and from all connected workstations. It
              cannot be undone.
            </p>
            <ul data-testid="export-lines">
              <li v-for="l in exportSummary" :key="l.kind">{{ l.text }}</li>
            </ul>
            <p v-if="missingNames.length">
              Not connected: {{ missingNames.join(", ") }}.
              {{ missingNames.length === 1 ? "It keeps its copy." : "They keep their copies." }}
            </p>
          </template>
          <p v-else-if="missingNames.length">
            Not connected: {{ missingNames.join(", ") }}. Their latest scans may be missing{{
              confirmingExport ? ` from this ${confirmingExport.noun}` : ""
            }}.
          </p>
          <p v-if="confirmingExport">
            {{ confirmingExport.verb }} the {{ confirmingExport.noun }} anyway?
          </p>
        </div>
        <div v-if="confirming === 'delete'" class="flex flex-col gap-3">
          <p v-if="session.deletingSession" role="status" class="text-2xl font-bold">Deleting…</p>
          <SlideToConfirm v-else label="Slide to delete" @confirm="confirm" />
          <button
            ref="cancel"
            type="button"
            :class="secondary"
            :disabled="session.deletingSession"
            @click="confirming = null"
          >
            Cancel
          </button>
        </div>
        <div v-else class="flex flex-wrap gap-3">
          <button type="button" :class="confirming === 'close' ? danger : primary" @click="confirm">
            {{ confirmingExport ? `${confirmingExport.verb} anyway` : "Yes, close session" }}
          </button>
          <button ref="cancel" type="button" :class="secondary" @click="confirming = null">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
