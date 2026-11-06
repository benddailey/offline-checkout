<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";

const banner = useTemplateRef<HTMLElement>("banner");

onMounted(() => banner.value?.scrollIntoView({ block: "nearest" }));
</script>

<template>
  <div
    ref="banner"
    role="status"
    class="rounded-lg border-4 border-red-700 bg-red-100 p-4 text-center text-3xl font-extrabold text-red-900"
  >
    Session closed
  </div>
</template>
