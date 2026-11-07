<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from "vue";
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

watch(
  () => session.closed || !session.currentVisit,
  (cannotVoid) => {
    if (cannotVoid && confirmingVoid.value) dismissVoid();
  },
);

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
      class="flex flex-wrap items-center gap-4 rounded-lg border-2 border-line-3 bg-page p-3"
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
      class="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-2 border-line-2 bg-raised p-4 text-center"
    >
      <p class="text-3xl font-bold text-ink-3">Scanning has stopped</p>
      <p class="text-xl text-ink-4">Exports are on the Summary.</p>
    </section>

    <section
      v-else-if="!session.currentVisit"
      class="flex min-h-64 items-center justify-center rounded-xl border-4 border-dashed border-line-3"
    >
      <p class="text-5xl font-extrabold text-ink-3">Scan patron card</p>
    </section>

    <section v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <p class="text-lg text-ink-4">Patron</p>
          <p class="font-mono text-5xl font-extrabold text-ink" data-testid="patron">
            {{ session.currentVisit.patron }}
          </p>
        </div>
        <div class="ml-auto flex flex-col items-end gap-2">
          <!-- The status bar's disabled buttons point here; it lives in the panel so the bar's height never changes mid-patron. -->
          <p
            v-if="session.lockedPatron"
            id="finish-patron"
            class="text-base font-semibold text-ink-3"
            data-testid="finish-patron"
          >
            Finish patron {{ session.lockedPatron }} first: End patron or Void patron
          </p>
          <div class="flex gap-3">
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
      </div>

      <p v-if="session.currentVisit.items.length === 0" class="text-2xl text-ink-4">Scan items…</p>
      <ol v-else class="divide-y-2 divide-line-1 rounded-lg border-2 border-line-2 bg-surface">
        <li
          v-for="item in newestFirst"
          :key="item.id"
          class="flex min-h-11.5 items-center gap-4 px-4 py-1"
          data-testid="item"
        >
          <span
            class="font-mono text-2xl"
            :class="item.voided ? 'text-ink-5 line-through' : 'text-ink'"
          >
            {{ item.barcode }}
          </span>
          <span v-if="item.voided" class="text-lg text-ink-5">voided</span>
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
      tabindex="-1"
      @keydown.esc="dismissVoid"
      @keydown.tab="trapTab(dialog, $event)"
    >
      <div
        ref="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="void-title"
        aria-describedby="void-text"
        :class="[dialogBox, 'max-w-xl border-danger-line']"
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
