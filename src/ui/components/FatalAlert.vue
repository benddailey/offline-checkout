<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <div
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="fatal-title"
    aria-describedby="fatal-text"
    class="fixed inset-0 z-50 flex items-center justify-center bg-red-700 p-8 text-white"
  >
    <div class="max-w-3xl text-center">
      <h2 id="fatal-title" class="mb-6 text-5xl font-extrabold">Stop</h2>
      <p id="fatal-text" class="text-3xl leading-snug font-semibold">{{ text }}</p>
      <p class="mt-8 text-xl">Tell a supervisor. Close this tab when you have finished.</p>
    </div>
  </div>
</template>
