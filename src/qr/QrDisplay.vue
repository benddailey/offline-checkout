<script setup lang="ts">
import QRCode from "qrcode";
import { ref, useTemplateRef, watchEffect } from "vue";
import { pairingFileText, saveTextFile, type CodeLabel } from "../pairing/file";
import { printErrorText, printPairingCode } from "../print/pairing-receipt";
import { secondary } from "../ui/classes";

const props = defineProps<{
  text: string;
  label: CodeLabel;
  sessionName?: string;
  expiresAt?: number;
  /** Shows Save to file when set. */
  fileName?: string;
}>();

const dataUrl = ref("");
const copied = ref(false);
const area = useTemplateRef<HTMLTextAreaElement>("area");
const textBox = useTemplateRef<HTMLDetailsElement>("textBox");

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
    // select() does nothing inside a closed <details>.
    if (textBox.value) textBox.value.open = true;
    area.value?.select();
    document.execCommand("copy");
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

const printError = ref("");
const saved = ref(false);

async function save() {
  if (!props.fileName) return;
  const text = pairingFileText(props.label, props.text, props.expiresAt);
  printError.value = "";
  try {
    if (!(await saveTextFile(props.fileName, text))) return;
  } catch {
    printError.value = "Could not save the file there. Try again or pick another folder.";
    return;
  }
  saved.value = true;
  setTimeout(() => (saved.value = false), 1500);
}

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
      class="aspect-square w-full max-w-[min(50vh,420px)] bg-white [image-rendering:pixelated]"
    />
    <div class="flex flex-wrap justify-center gap-3">
      <button type="button" :class="secondary" @click="copy">
        {{ copied ? "Copied" : "Copy" }}
      </button>
      <button type="button" :class="secondary" @click="print">Print code</button>
      <button
        v-if="fileName"
        type="button"
        :class="secondary"
        title="Save the code as a temporary file on a shared network drive or flash drive, then load it on the other workstation. Delete the file after pairing."
        @click="save"
      >
        {{ saved ? "Saved" : "Save to file" }}
      </button>
    </div>
    <p v-if="printError" role="alert" class="rounded bg-amber-100 p-2 text-base text-amber-900">
      {{ printError }}
    </p>
    <details ref="textBox" class="w-full text-base">
      <summary class="cursor-pointer font-semibold text-slate-700">Show the code as text</summary>
      <label class="mt-2 flex flex-col gap-1 font-semibold">
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
    </details>
  </div>
</template>
