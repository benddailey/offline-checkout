<script setup lang="ts">
import { tool } from "../classes";
import { cycleTheme, themeLabel } from "../theme";
</script>

<!-- A button, not a select: ScanInput sends scanner keys on a button to the scan field, but leaves a select focused. -->
<template>
  <button type="button" :class="tool" @click="cycleTheme">Theme: {{ themeLabel }}</button>
</template>
