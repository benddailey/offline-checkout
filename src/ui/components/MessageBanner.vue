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
  info: "border-accent bg-accent-soft text-accent-ink",
  warn: "border-warn-line bg-warn-soft text-warn-ink",
  error: "border-danger-line bg-danger-soft text-danger-ink",
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
