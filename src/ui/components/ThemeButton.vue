<script setup lang="ts">
import { computed } from "vue";
import { credit, PHOTOS } from "../backgrounds/photos";
import { tool, toolOn } from "../classes";
import {
  availableBackgrounds,
  currentBackground,
  missingPhotos,
  currentTheme,
  setBackground,
  setTheme,
  THEMES,
} from "../theme";

defineOptions({ inheritAttrs: false });

const about = computed(() => {
  if (currentBackground.value === "shelves") {
    return "One book for each Evergreen Indiana library, sized by the population it serves.";
  }
  const photo = PHOTOS.find((p) => p.id === currentBackground.value);
  return photo ? credit(photo) : "";
});
</script>

<!-- A popover of buttons, not a select: ScanInput sends scanner keys on a button to the scan field, but leaves a select focused.
     It stays open while the clerk tries choices; a click outside or Esc closes it. -->
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
    class="inset-auto m-0 mt-2 max-h-[calc(100vh-6rem)] w-[min(40rem,calc(100vw-2rem))] gap-x-6 gap-y-3 overflow-y-auto rounded-xl border-2 border-line-2 bg-surface p-4 text-ink shadow-xl [position-anchor:--theme-button] [position-area:bottom_span-left] [position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline] open:grid sm:grid-cols-[auto_1fr]"
  >
    <div role="group" aria-labelledby="theme-menu-theme" class="flex flex-col gap-2">
      <h2 id="theme-menu-theme" class="text-lg font-bold">Theme</h2>
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        :class="t.id === currentTheme ? toolOn : tool"
        class="text-left"
        :aria-pressed="t.id === currentTheme"
        @click="setTheme(t.id)"
      >
        {{ t.label }}
      </button>
    </div>
    <div role="group" aria-labelledby="theme-menu-background" class="flex flex-col gap-2">
      <h2 id="theme-menu-background" class="text-lg font-bold">Background</h2>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="b in availableBackgrounds"
          :key="b.id"
          type="button"
          :class="b.id === currentBackground ? toolOn : tool"
          class="text-left"
          :aria-pressed="b.id === currentBackground"
          @click="setBackground(b.id)"
        >
          {{ b.label }}
        </button>
      </div>
    </div>
    <p v-if="about" class="text-base text-ink-3 sm:col-span-2" data-testid="background-credit">
      {{ about }}
    </p>
    <p v-if="missingPhotos" class="text-base text-ink-3 sm:col-span-2" data-testid="photos-missing">
      {{ missingPhotos === 1 ? "1 more photo downloads" : `${missingPhotos} more photos download` }}
      when this PC is online.
    </p>
  </div>
</template>
