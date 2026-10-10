<script setup lang="ts">
import QRCode from "qrcode";
import { ref, useTemplateRef, watchEffect } from "vue";

const props = defineProps<{ text: string; label: string }>();

const dataUrl = ref("");
const copied = ref(false);
const area = useTemplateRef<HTMLTextAreaElement>("area");

watchEffect(async (onCleanup) => {
  let stale = false;
  onCleanup(() => (stale = true));
  const url = await QRCode.toDataURL(props.text, { errorCorrectionLevel: "M", margin: 4 });
  if (!stale) dataUrl.value = url;
});

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
  } catch {
    area.value?.select();
    document.execCommand("copy");
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="flex flex-col items-center gap-3">
    <img
      v-if="dataUrl"
      :src="dataUrl"
      :alt="`QR code: ${label}`"
      class="h-72 w-72 bg-white [image-rendering:pixelated]"
    />
    <label class="flex w-full flex-col gap-1 text-base font-semibold">
      {{ label }}
      <textarea
        ref="area"
        readonly
        rows="4"
        :value="text"
        class="w-full rounded border-2 border-slate-500 p-2 font-mono text-xs break-all"
        @focus="area?.select()"
      />
    </label>
    <button
      type="button"
      class="min-h-12 rounded-lg bg-slate-800 px-6 text-lg font-semibold text-white hover:bg-slate-700"
      @click="copy"
    >
      {{ copied ? "Copied" : "Copy" }}
    </button>
  </div>
</template>
