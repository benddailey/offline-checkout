<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import { slideKey, slideRelease } from "../slide";

const props = defineProps<{ label: string }>();
const emit = defineEmits<{ confirm: [] }>();

const track = useTemplateRef<HTMLElement>("track");
const handle = useTemplateRef<HTMLElement>("handle");
const value = ref(0);
const dragging = ref(false);
let startX = 0;
let startPx = 0;
let travel = 0;

function measure() {
  travel = Math.max(1, (track.value?.clientWidth ?? 0) - (handle.value?.offsetWidth ?? 0));
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (value.value === 100) return;
  measure();
  startX = e.clientX;
  startPx = (value.value / 100) * travel;
  dragging.value = true;
  handle.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  const px = Math.min(travel, Math.max(0, startPx + e.clientX - startX));
  value.value = (px / travel) * 100;
}

function onPointerEnd() {
  if (!dragging.value) return;
  dragging.value = false;
  if (slideRelease((value.value / 100) * travel, travel)) finish();
  else value.value = 0;
}

function finish() {
  value.value = 100;
  emit("confirm");
}

function onKeydown(e: KeyboardEvent) {
  const r = slideKey(value.value, e.key);
  if (!r) return;
  e.preventDefault();
  value.value = r.value;
  if (r.confirm) emit("confirm");
}

function onBlur() {
  if (value.value < 100) value.value = 0;
}
</script>

<template>
  <div
    ref="track"
    class="relative min-h-12 select-none overflow-hidden rounded-lg border-2 border-red-800 bg-red-100"
  >
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-red-300"
      :style="{ width: `calc(${value / 100} * (100% - 4rem) + 4rem)` }"
    ></div>
    <span
      class="pointer-events-none absolute inset-0 flex items-center justify-center pl-16 text-xl font-semibold text-red-900"
    >
      {{ props.label }}
    </span>
    <div
      ref="handle"
      role="slider"
      tabindex="0"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(value)"
      :aria-valuetext="`${props.label}, ${Math.round(value)}%`"
      class="absolute inset-y-0 flex min-h-12 w-16 cursor-grab touch-none items-center justify-center rounded-md border-2 border-red-800 bg-red-700 text-xl font-semibold text-white focus:outline-2 focus:outline-offset-2 focus:outline-red-900"
      :class="{ 'cursor-grabbing': dragging, 'transition-[left] duration-150': !dragging }"
      :style="{ left: `calc(${value / 100} * (100% - 4rem))` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @keydown="onKeydown"
      @blur="onBlur"
    >
      <span aria-hidden="true">&rarr;</span>
    </div>
  </div>
</template>
