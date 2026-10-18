<script setup lang="ts">
import QRCode from "qrcode";
import { ref, useTemplateRef, watchEffect } from "vue";
import { printErrorText, printPairingCode } from "../print/pairing-receipt";

const props = defineProps<{
  text: string;
  label: "Join code" | "Reply code";
  sessionName?: string;
  expiresAt?: number;
}>();

const dataUrl = ref("");
const copied = ref(false);
const area = useTemplateRef<HTMLTextAreaElement>("area");

watchEffect(async (onCleanup) => {
  let stale = false;
  onCleanup(() => (stale = true));
  const url = await QRCode.toDataURL(props.text, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 840,
  });
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

const printError = ref("");

function print() {
  printError.value = "";
  try {
    printPairingCode({
      label: props.label,
      code: props.text,
      sessionName: props.sessionName,
      expiresAt: props.expiresAt,
    });
  } catch (err) {
    printError.value = printErrorText(err);
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-3">
    <img
      v-if="dataUrl"
      :src="dataUrl"
      :alt="`QR code: ${label}`"
      class="aspect-square w-full max-w-[min(60vh,420px)] bg-white [image-rendering:pixelated]"
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
    <div class="flex gap-3">
      <button
        type="button"
        class="min-h-12 rounded-lg bg-slate-800 px-6 text-lg font-semibold text-white hover:bg-slate-700"
        @click="copy"
      >
        {{ copied ? "Copied" : "Copy" }}
      </button>
      <button
        type="button"
        class="min-h-12 rounded-lg bg-slate-800 px-6 text-lg font-semibold text-white hover:bg-slate-700"
        @click="print"
      >
        Print code
      </button>
    </div>
    <p v-if="printError" role="alert" class="rounded bg-amber-100 p-2 text-base text-amber-900">
      {{ printError }}
    </p>
  </div>
</template>
