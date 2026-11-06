<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";

/**
 * `quiet`: on a screen where scanning isn't the main job; it works the same but draws less attention.
 * `paused`: a modal dialog owns focus. Scanner keystrokes outside text fields are dropped (so a
 * scan's Enter never presses a dialog button) and focus is not taken back until it closes.
 */
const props = defineProps<{ paused?: boolean; quiet?: boolean }>();
const emit = defineEmits<{ scan: [value: string] }>();
const input = useTemplateRef<HTMLInputElement>("input");

let timer: ReturnType<typeof setTimeout> | null = null;

function refocusSoon() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const el = input.value;
    if (!el || props.paused) return;
    const active = document.activeElement;
    // Never take focus from another text field the clerk is typing into.
    if (active && active !== el && active.matches("input, textarea, select")) return;
    // Scrolling here would move a button further down the page out from under a mouse press.
    el.focus({ preventScroll: true });
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
  if (props.paused) {
    if (e.key === "Enter" || e.key.length === 1) e.preventDefault();
    return;
  }
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

watch(
  () => props.paused,
  (paused) => {
    if (!paused) refocusSoon();
  },
);

onMounted(() => {
  input.value?.focus();
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown, true);
  window.addEventListener("afterprint", refocusSoon);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown, true);
  window.removeEventListener("afterprint", refocusSoon);
  if (timer !== null) clearTimeout(timer);
});
</script>

<template>
  <label class="block">
    <span class="mb-1 block font-semibold text-slate-700" :class="quiet ? 'text-base' : 'text-lg'">
      Scanner input
    </span>
    <input
      ref="input"
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      class="block w-full rounded-lg bg-white px-4 font-mono text-slate-900 focus:outline-none"
      :class="
        quiet
          ? 'min-h-11 border-2 border-slate-400 text-xl focus:border-slate-500 focus:ring-2 focus:ring-slate-300'
          : 'min-h-14 border-4 border-blue-600 text-2xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300'
      "
      data-testid="scan-input"
      @keydown.enter.prevent="onEnter"
      @blur="refocusSoon"
    />
  </label>
</template>
