<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import {
  addScan,
  emptyCollector,
  INVALID_MESSAGE,
  OTHER_SET_MESSAGE,
  progressText,
} from "../pairing/chunks";
import { codeFromFile } from "../pairing/file";
import QrCamera from "./QrCamera.vue";

/** `files` adds Load code from file and drag-and-drop of a saved pairing file. */
const props = defineProps<{ files?: boolean }>();
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

function onDetect(text: string) {
  paused.value = true;
  emitText(text);
}

/** One scanned barcode: a printed piece, or a whole code. */
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

const picker = useTemplateRef<HTMLInputElement>("picker");
const fileError = ref("");
const dragging = ref(false);

async function loadFile(file: File | undefined) {
  if (!file) return;
  fileError.value = "";
  const code = codeFromFile(await file.text());
  if (code) emitText(code);
  else
    fileError.value = `${file.name} has no pairing code in it. Pick the file saved on the other workstation.`;
}

async function onPicked() {
  const input = picker.value;
  await loadFile(input?.files?.[0]);
  if (input) input.value = "";
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  if (props.files) void loadFile(e.dataTransfer?.files[0]);
}
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded"
    :class="{ 'ring-4 ring-blue-400': dragging }"
    @dragover.prevent="dragging = !!files"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="relative h-72 w-full overflow-hidden rounded bg-slate-900">
      <QrCamera :paused="paused" @detect="onDetect" @error="cameraError = true" />
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
    <template v-if="files">
      <input
        ref="picker"
        type="file"
        accept=".txt,text/plain"
        class="hidden"
        data-testid="code-file"
        @change="onPicked"
      />
      <button
        type="button"
        class="min-h-12 rounded-lg bg-slate-800 px-6 text-lg font-semibold text-white hover:bg-slate-700"
        title="Open the temporary code file saved on the other workstation, from a shared network drive or flash drive. You can also drag the file here. Delete the file after pairing."
        @click="picker?.click()"
      >
        Load code from file
      </button>
      <p
        v-if="fileError"
        role="alert"
        class="rounded bg-red-100 p-2 text-base font-semibold text-red-900"
      >
        {{ fileError }}
      </p>
    </template>
  </div>
</template>
