<script setup lang="ts">
import ScanInput from "../components/ScanInput.vue";
import { useSession } from "../session";

const session = useSession();

const toneClass = {
  info: "border-blue-700 bg-blue-50 text-blue-900",
  warn: "border-amber-600 bg-amber-100 text-amber-950",
  error: "border-red-700 bg-red-100 text-red-900",
} as const;

const button =
  "min-h-12 rounded-lg border-2 px-5 text-xl font-semibold disabled:cursor-not-allowed disabled:opacity-40";

function printCard() {
  session.printScannerCard();
  session.offerScannerCard = false;
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
    <div
      v-if="session.closed"
      role="status"
      class="rounded-lg border-4 border-red-700 bg-red-100 p-4 text-center text-3xl font-extrabold text-red-900"
    >
      Session closed
    </div>

    <div
      v-if="session.offerScannerCard"
      class="flex flex-wrap items-center gap-4 rounded-lg border-2 border-slate-400 bg-slate-50 p-3"
    >
      <p class="text-lg">
        Print the scanner card with the <b>End patron</b> and <b>Void last item</b> barcodes?
      </p>
      <div class="ml-auto flex gap-2">
        <button
          type="button"
          :class="[button, 'border-blue-700 bg-blue-700 text-white']"
          @click="printCard"
        >
          Print scanner card
        </button>
        <button
          type="button"
          :class="[button, 'border-slate-500 bg-white']"
          @click="session.offerScannerCard = false"
        >
          Not now
        </button>
      </div>
    </div>

    <ScanInput @scan="session.scan" />

    <div
      v-if="session.message"
      role="alert"
      class="rounded-lg border-l-8 p-3 text-2xl font-semibold"
      :class="toneClass[session.message.tone]"
      data-testid="message"
    >
      {{ session.message.text }}
    </div>

    <section
      v-if="!session.currentVisit"
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
            :class="[button, 'border-green-800 bg-green-700 text-white']"
            :disabled="session.closed"
            @click="session.endPatron()"
          >
            End patron
          </button>
          <button
            type="button"
            :class="[button, 'border-red-700 bg-white text-red-800']"
            :disabled="session.closed"
            @click="session.voidPatron()"
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
          v-for="item in session.currentVisit.items"
          :key="item.id"
          class="flex items-center gap-4 px-4 py-2"
          data-testid="item"
        >
          <span
            class="font-mono text-2xl"
            :class="item.voided ? 'text-slate-400 line-through' : 'text-slate-900'"
          >
            {{ item.barcode }}
          </span>
          <span v-if="item.voided" class="text-lg text-slate-500">voided</span>
          <button
            v-else
            type="button"
            :class="[button, 'ml-auto border-red-700 bg-white text-red-800']"
            :disabled="session.closed"
            :aria-label="`Void ${item.barcode}`"
            @click="session.voidRecord(item.id)"
          >
            Void
          </button>
        </li>
      </ol>
    </section>
  </main>
</template>
