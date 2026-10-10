<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";

const emit = defineEmits<{ scan: [value: string] }>();
const input = useTemplateRef<HTMLInputElement>("input");

let timer: ReturnType<typeof setTimeout> | null = null;

function refocusSoon() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const el = input.value;
    if (!el) return;
    const active = document.activeElement;
    // Never take focus from another text field the clerk is typing into.
    if (active && active !== el && active.matches("input, textarea, select")) return;
    el.focus();
  }, 0);
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as Element | null;
  // Buttons and fields handle their own clicks; blur on them already schedules a refocus.
  if (target?.closest?.("button, input, textarea, select")) return;
  refocusSoon();
}

/**
 * Scanner keystrokes that land anywhere but a text field (body, a just-clicked button)
 * go to the scanner input, so none are lost and Enter never activates a button.
 */
function onDocumentKeydown(e: KeyboardEvent) {
  const el = input.value;
  if (!el || e.target === el || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as Element | null)?.closest?.("input, textarea, select")) return;
  if (e.key === "Enter") {
    e.preventDefault();
    el.focus();
    onEnter();
  } else if (e.key.length === 1) {
    e.preventDefault();
    el.focus();
    el.value += e.key;
  }
}

function onEnter() {
  const el = input.value;
  if (!el) return;
  const value = el.value;
  el.value = "";
  if (value.trim() !== "") emit("scan", value);
}

onMounted(() => {
  input.value?.focus();
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown, true);
  if (timer !== null) clearTimeout(timer);
});
</script>

<template>
  <label class="block">
    <span class="mb-1 block text-lg font-semibold text-slate-700">Scanner input</span>
    <input
      ref="input"
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      class="block min-h-14 w-full rounded-lg border-4 border-blue-600 bg-white px-4 font-mono text-2xl text-slate-900 focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none"
      data-testid="scan-input"
      @keydown.enter.prevent="onEnter"
      @blur="refocusSoon"
    />
  </label>
</template>
