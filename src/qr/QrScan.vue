<script setup lang="ts">
import { ref } from "vue";
import { QrcodeStream, type DetectedBarcode } from "vue-qrcode-reader";
import {
  addScan,
  emptyCollector,
  INVALID_MESSAGE,
  OTHER_SET_MESSAGE,
  progressText,
} from "../pairing/chunks";

const emit = defineEmits<{ decoded: [text: string] }>();

const cameraError = ref(false);
const pasted = ref("");
// Camera frames repeat the same code; consumers are not idempotent, so scan once then pause.
const paused = ref(false);

const scanned = ref("");
const collector = ref(emptyCollector());
const progress = ref("");
const chunkError = ref("");

function startOver() {
  collector.value = emptyCollector();
  progress.value = "";
  chunkError.value = "";
}

function reset() {
  paused.value = false;
  startOver();
}
defineExpose({ reset, acceptScan });

function emitText(raw: string) {
  const text = raw.trim();
  if (text) emit("decoded", text);
}

function onDetect(codes: DetectedBarcode[]) {
  for (const code of codes) {
    if (code.rawValue.trim()) {
      paused.value = true;
      return emitText(code.rawValue);
    }
  }
}

/** One scanned barcode: a printed piece, or a whole OC1: code. */
function acceptScan(text: string) {
  if (!text.trim()) return;
  const r = addScan(collector.value, text);
  switch (r.kind) {
    case "full":
    case "complete":
      startOver();
      return emitText(r.code);
    case "added":
    case "repeat":
      collector.value = r.collector;
      progress.value = progressText(r.collector);
      chunkError.value = "";
      return;
    case "other-set":
      chunkError.value = OTHER_SET_MESSAGE;
      return;
    case "invalid":
      chunkError.value = INVALID_MESSAGE;
  }
}

/** Enter or Tab ends each printed barcode; both stay in the field so the next scan lands here too. */
function onScannerKey(e: KeyboardEvent) {
  if ((e.key !== "Enter" && e.key !== "Tab") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    return;
  e.preventDefault();
  const text = scanned.value;
  scanned.value = "";
  acceptScan(text);
}

function usePasted() {
  emitText(pasted.value);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="relative h-72 w-full overflow-hidden rounded bg-slate-900">
      <QrcodeStream
        :formats="['qr_code']"
        :paused="paused"
        @detect="onDetect"
        @error="cameraError = true"
      />
    </div>
    <p v-if="cameraError" role="alert" class="rounded bg-amber-100 p-2 text-base text-amber-900">
      Camera unavailable. Click Allow on the camera prompt in the address bar, or paste the code
      below.
    </p>
    <label class="flex flex-col gap-1 text-base font-semibold">
      Scanner (printed code)
      <input
        v-model="scanned"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="Click here, then scan the barcodes"
        class="min-h-12 w-full rounded border-2 border-slate-500 p-2 font-mono text-base font-normal focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none"
        @keydown="onScannerKey"
      />
    </label>
    <p v-if="progress" role="status" data-testid="chunk-progress" class="text-base text-slate-800">
      {{ progress }}
    </p>
    <p
      v-if="chunkError"
      role="alert"
      data-testid="chunk-error"
      class="rounded bg-red-100 p-2 text-base font-semibold text-red-900"
    >
      {{ chunkError }}
    </p>
    <button
      v-if="collector.parts.size > 0"
      type="button"
      class="min-h-12 self-start rounded-lg border-2 border-slate-700 bg-white px-6 text-lg font-semibold text-slate-900 hover:bg-slate-100"
      @click="startOver"
    >
      Start over
    </button>
    <label class="flex flex-col gap-1 text-base font-semibold">
      Pasted code
      <textarea
        v-model="pasted"
        rows="4"
        class="w-full rounded border-2 border-slate-500 p-2 font-mono text-xs"
      />
    </label>
    <button
      type="button"
      class="min-h-12 rounded-lg bg-slate-800 px-6 text-lg font-semibold text-white hover:bg-slate-700"
      @click="usePasted"
    >
      Use pasted code
    </button>
  </div>
</template>
