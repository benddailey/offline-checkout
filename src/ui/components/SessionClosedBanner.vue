<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";

const banner = useTemplateRef<HTMLElement>("banner");

onMounted(() => banner.value?.scrollIntoView({ block: "nearest" }));
</script>

<template>
  <div
    ref="banner"
    role="status"
    class="rounded-lg border-4 border-danger-line bg-danger-soft p-4 text-center text-3xl font-extrabold text-danger-ink"
  >
    Session closed
  </div>
</template>
