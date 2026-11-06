<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useTemplateRef } from "vue";
import {
  danger,
  dangerOutline,
  dialogBox,
  dialogOverlay,
  primary,
  secondary,
  success,
  rowVoid,
} from "../classes";
import MessageBanner from "../components/MessageBanner.vue";
import ScanInput from "../components/ScanInput.vue";
import SessionClosedBanner from "../components/SessionClosedBanner.vue";
import { trapTab } from "../focus-trap";
import { useSession } from "../session";

const session = useSession();

const newestFirst = computed(() => [...(session.currentVisit?.items ?? [])].reverse());
const activeItems = computed(() => newestFirst.value.filter((i) => !i.voided).length);

const confirmingVoid = ref(false);
const dialog = useTemplateRef<HTMLElement>("dialog");
const cancelButton = useTemplateRef<HTMLButtonElement>("cancel");

/** A patron with nothing on them is usually a mistaken scan, so voiding it doesn't ask. */
async function askVoidPatron(): Promise<void> {
  if (activeItems.value === 0) {
    void session.voidPatron();
    return;
  }
  confirmingVoid.value = true;
  session.toolbarDialog = true;
  await nextTick();
  cancelButton.value?.focus();
}

function dismissVoid(): void {
  confirmingVoid.value = false;
  session.toolbarDialog = false;
}

function confirmVoid(): void {
  dismissVoid();
  void session.voidPatron();
}

onUnmounted(() => {
  if (confirmingVoid.value) session.toolbarDialog = false;
});

function printCard(format: "receipt" | "letter") {
  session.offerScannerCard = false;
  void session.printScannerCard(format);
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4">
    <SessionClosedBanner v-if="session.closed" />

    <div
      v-if="session.offerScannerCard"
      class="flex flex-wrap items-center gap-4 rounded-lg border-2 border-slate-400 bg-slate-50 p-3"
    >
      <p class="text-lg">
        Print the scanner card with the <b>End patron</b> and <b>Void last item</b> barcodes?
      </p>
      <div class="ml-auto flex gap-2">
        <button type="button" :class="primary" @click="printCard('receipt')">
          Receipt printer
        </button>
        <button type="button" :class="secondary" @click="printCard('letter')">Letter PDF</button>
        <button type="button" :class="secondary" @click="session.offerScannerCard = false">
          Not now
        </button>
      </div>
    </div>

    <ScanInput :paused="session.toolbarDialog" @scan="session.scan" />

    <MessageBanner v-if="session.message" :message="session.message" />

    <section
      v-if="!session.currentVisit && session.closed"
      class="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-slate-100 p-4 text-center"
    >
      <p class="text-3xl font-bold text-slate-700">Scanning has stopped</p>
      <p class="text-xl text-slate-600">Exports are on the Summary.</p>
    </section>

    <section
      v-else-if="!session.currentVisit"
      class="flex min-h-64 items-center justify-center rounded-xl border-4 border-dashed border-slate-400"
    >
      <p class="text-5xl font-extrabold text-slate-700">Scan patron card</p>
    </section>

    <section v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <p class="text-lg text-slate-600">Patron</p>
          <p class="font-mono text-5xl font-extrabold text-slate-900" data-testid="patron">
            {{ session.currentVisit.patron }}
          </p>
        </div>
        <div class="ml-auto flex gap-3">
          <button
            type="button"
            :class="success"
            :disabled="session.closed"
            @click="session.endPatron()"
          >
            End patron
          </button>
          <button
            type="button"
            :class="dangerOutline"
            :disabled="session.closed"
            @click="askVoidPatron"
          >
            Void patron
          </button>
        </div>
      </div>

      <p v-if="session.currentVisit.items.length === 0" class="text-2xl text-slate-600">
        Scan items…
      </p>
      <ol v-else class="divide-y-2 divide-slate-200 rounded-lg border-2 border-slate-300 bg-white">
        <li
          v-for="item in newestFirst"
          :key="item.id"
          class="flex min-h-11.5 items-center gap-4 px-4 py-1"
          data-testid="item"
        >
          <span
            class="font-mono text-2xl"
            :class="item.voided ? 'text-slate-500 line-through' : 'text-slate-900'"
          >
            {{ item.barcode }}
          </span>
          <span v-if="item.voided" class="text-lg text-slate-500">voided</span>
          <button
            v-else
            type="button"
            :class="[rowVoid, 'ml-auto']"
            :disabled="session.closed"
            :aria-label="`Void ${item.barcode}`"
            @click="session.voidRecord(item.id)"
          >
            Void
          </button>
        </li>
      </ol>
    </section>

    <div
      v-if="confirmingVoid && session.currentVisit"
      :class="dialogOverlay"
      @keydown.esc="dismissVoid"
      @keydown.tab="trapTab(dialog, $event)"
    >
      <div
        ref="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="void-title"
        aria-describedby="void-text"
        :class="[dialogBox, 'max-w-xl border-red-700']"
      >
        <h2 id="void-title" class="text-3xl font-extrabold">Void patron</h2>
        <p id="void-text" class="text-xl">
          Void patron {{ session.currentVisit.patron }} and their {{ activeItems }}
          {{ activeItems === 1 ? "item" : "items" }}? No receipt prints, and this can't be undone.
        </p>
        <div class="flex flex-wrap gap-3">
          <button type="button" :class="danger" @click="confirmVoid">Yes, void patron</button>
          <button ref="cancel" type="button" :class="secondary" @click="dismissVoid">Cancel</button>
        </div>
      </div>
    </div>
  </main>
</template>
