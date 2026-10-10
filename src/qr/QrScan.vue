<script setup lang="ts">
import { ref } from "vue";
import { QrcodeStream, type DetectedBarcode } from "vue-qrcode-reader";

const emit = defineEmits<{ decoded: [text: string] }>();

const cameraError = ref(false);
const pasted = ref("");

function emitText(raw: string) {
  const text = raw.trim();
  if (text) emit("decoded", text);
}

function onDetect(codes: DetectedBarcode[]) {
  for (const code of codes) {
    if (code.rawValue.trim()) return emitText(code.rawValue);
  }
}

function usePasted() {
  emitText(pasted.value);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="relative h-72 w-full overflow-hidden rounded bg-slate-900">
      <QrcodeStream :formats="['qr_code']" @detect="onDetect" @error="cameraError = true" />
    </div>
    <p v-if="cameraError" role="alert" class="rounded bg-amber-100 p-2 text-sm text-amber-900">
      Camera unavailable. Click Allow on the camera prompt in the address bar, or paste the code
      below.
    </p>
    <label class="flex flex-col gap-1 text-sm font-medium">
      Pasted code
      <textarea
        v-model="pasted"
        rows="4"
        class="w-full rounded border border-slate-300 p-2 font-mono text-xs"
      />
    </label>
    <button
      type="button"
      class="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
      @click="usePasted"
    >
      Use pasted code
    </button>
  </div>
</template>
