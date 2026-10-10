<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import type { RecordId } from "../../log/types";
import { blocksFromState } from "../../pdf/blocks";
import { useSession } from "../session";

const session = useSession();

interface Row {
  id: RecordId;
  barcode: string;
  voided: boolean;
}
interface PatronRow {
  patron: string;
  /** Every visit for this patron was voided: it is left out of the PDF. */
  voided: boolean;
  rows: Row[];
  /** Item count and clerks as printed on the PDF. */
  items: number;
  clerks: string[];
  at: number;
}

/**
 * Patrons in PDF order (first non-voided scan), each with every item scanned for them, voided
 * ones included. Fully voided patrons are listed where their first visit was scanned.
 */
const patrons = computed<PatronRow[]>(() => {
  const st = session.state;
  const blocks = new Map(blocksFromState(st).map((b) => [b.patron, b]));
  const byPatron = new Map<string, PatronRow>();
  for (const v of st.visits) {
    let p = byPatron.get(v.patron);
    if (!p) {
      const block = blocks.get(v.patron);
      p = {
        patron: v.patron,
        voided: !block,
        rows: [],
        items: block?.items.length ?? 0,
        clerks: block?.clerks ?? [v.employee],
        at: block?.firstAt ?? v.at,
      };
      byPatron.set(v.patron, p);
    }
    for (const i of v.items) {
      p.rows.push({ id: i.id, barcode: i.barcode, voided: i.voided || v.voided });
    }
  }
  return [...byPatron.values()].sort(
    (a, b) => a.at - b.at || (a.patron < b.patron ? -1 : a.patron > b.patron ? 1 : 0),
  );
});

const clerks = computed(() =>
  Object.keys(session.state.perClerk)
    .sort()
    .map((name) => ({ name, ...session.state.perClerk[name]! })),
);

const canGenerate = computed(() => session.state.totals.patrons > 0);

const confirming = ref(false);
const cancelButton = useTemplateRef<HTMLButtonElement>("cancel");

async function askClose(): Promise<void> {
  confirming.value = true;
  await nextTick();
  cancelButton.value?.focus();
}

async function confirmClose(): Promise<void> {
  confirming.value = false;
  await session.closeSession();
}

const toneClass = {
  info: "border-blue-700 bg-blue-50 text-blue-900",
  warn: "border-amber-600 bg-amber-100 text-amber-950",
  error: "border-red-700 bg-red-100 text-red-900",
} as const;

const button =
  "min-h-12 rounded-lg border-2 px-5 text-xl font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} border-blue-800 bg-blue-700 text-white hover:bg-blue-800 disabled:hover:bg-blue-700`;
const secondary = `${button} border-slate-700 bg-white text-slate-900 hover:bg-slate-100`;
const danger = `${button} border-red-800 bg-red-700 text-white hover:bg-red-800`;
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
    <div
      v-if="session.closed"
      role="status"
      class="rounded-lg border-4 border-red-700 bg-red-100 p-4 text-center text-3xl font-extrabold text-red-900"
    >
      Session closed
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-3xl font-extrabold text-slate-900">Session summary</h1>
      <button type="button" :class="[secondary, 'ml-auto']" @click="session.screen = 'scan'">
        Back to scanning
      </button>
    </div>

    <div
      v-if="session.message"
      role="alert"
      class="rounded-lg border-l-8 p-3 text-2xl font-semibold"
      :class="toneClass[session.message.tone]"
    >
      {{ session.message.text }}
    </div>

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
            {{ c.name }}: {{ c.patrons }} patrons, {{ c.items }} items
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
          aria-describedby="generate-hint"
          @click="session.generatePdf()"
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
          <button type="button" :class="danger" @click="askClose">Close session</button>
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
      @keydown.esc="confirming = false"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-title"
        aria-describedby="close-text"
        class="flex max-w-xl flex-col gap-5 rounded-xl border-4 border-red-700 bg-white p-6"
      >
        <h2 id="close-title" class="text-3xl font-extrabold">Close session</h2>
        <p id="close-text" class="text-2xl">
          Close this session for all workstations? Scanning will stop everywhere.
        </p>
        <div class="flex flex-wrap gap-3">
          <button type="button" :class="danger" @click="confirmClose">Yes, close session</button>
          <button ref="cancel" type="button" :class="secondary" @click="confirming = false">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
