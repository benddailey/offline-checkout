<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from "vue";
import type { Message } from "../session";

const props = defineProps<{ message: Message }>();
const banner = useTemplateRef<HTMLElement>("banner");

/** A new message may be the only sign that something failed, so it never appears off screen. */
function reveal(): void {
  banner.value?.scrollIntoView({ block: "nearest" });
}

onMounted(reveal);
watch(() => props.message, reveal, { flush: "post" });

const toneClass = {
  info: "border-blue-700 bg-blue-50 text-blue-900",
  warn: "border-amber-600 bg-amber-100 text-amber-950",
  error: "border-red-700 bg-red-100 text-red-900",
} as const;
</script>

<template>
  <div
    ref="banner"
    role="alert"
    class="rounded-lg border-l-8 p-3 text-2xl font-semibold"
    :class="toneClass[message.tone]"
    data-testid="message"
  >
    {{ message.text }}
  </div>
</template>
