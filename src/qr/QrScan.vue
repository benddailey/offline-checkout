<script setup lang="ts">
import { ref } from "vue";
import { QrcodeStream, type DetectedBarcode } from "vue-qrcode-reader";

const emit = defineEmits<{ decoded: [text: string] }>();

const cameraError = ref(false);
const pasted = ref("");
// Camera frames repeat the same code; consumers are not idempotent, so scan once then pause.
const paused = ref(false);

function reset() {
  paused.value = false;
}
defineExpose({ reset });

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
