<script setup lang="ts">
import { tool, toolOn } from "../classes";
import { currentTheme, setTheme, THEMES } from "../theme";

defineOptions({ inheritAttrs: false });
</script>

<!-- A popover of buttons, not a select: ScanInput sends scanner keys on a button to the scan field, but leaves a select focused. -->
<template>
  <button
    v-bind="$attrs"
    type="button"
    :class="tool"
    class="[anchor-name:--theme-button]"
    popovertarget="theme-menu"
  >
    Theme
  </button>
  <div
    id="theme-menu"
    popover
    role="group"
    aria-label="Theme"
    class="inset-auto m-0 mt-2 flex-col gap-2 rounded-xl border-2 border-line-2 bg-surface p-2 text-ink shadow-xl [position-anchor:--theme-button] [position-area:bottom_span-left] [position-try-fallbacks:flip-block] open:flex"
  >
    <button
      v-for="t in THEMES"
      :key="t.id"
      type="button"
      :class="t.id === currentTheme ? toolOn : tool"
      class="text-left"
      :aria-pressed="t.id === currentTheme"
      popovertarget="theme-menu"
      popovertargetaction="hide"
      @click="setTheme(t.id)"
    >
      {{ t.label }}
    </button>
  </div>
</template>
