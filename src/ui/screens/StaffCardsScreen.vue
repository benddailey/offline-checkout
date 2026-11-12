<script setup lang="ts">
import { computed, ref } from "vue";
import { downloadBlob, renderStaffCards } from "../../pdf/render";
import { CARD_COUNT, fillRest, staffCardError, staffValue } from "../../pdf/staff-cards";
import ThemeButton from "../components/ThemeButton.vue";
import { field, primary, secondary, tool } from "../classes";
import { useSession } from "../session";

const session = useSession();
const values = ref<string[]>(Array<string>(CARD_COUNT).fill(""));
const errors = computed(() => values.value.map(staffCardError));
const ready = computed(
  () => errors.value.every((e) => e === null) && values.value.some((v) => staffValue(v) !== ""),
);

function fill(i: number) {
  values.value = fillRest(values.value, i);
}

function generate() {
  if (ready.value) downloadBlob(renderStaffCards(values.value), "staff-barcodes.pdf");
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-3xl font-extrabold text-ink">Staff barcodes</h1>
      <ThemeButton class="ml-auto" />
      <button type="button" :class="secondary" @click="session.screen = 'launch'">Back</button>
    </div>

    <p class="text-xl text-ink-3">
      Type a staff login for each card, exactly as it should scan: capital and small letters are
      kept. Cards are laid out as on the sheet, left to right, then top to bottom. Empty cards are
      left blank.
    </p>

    <form class="flex flex-col gap-6" data-testid="staff-cards-form" @submit.prevent="generate">
      <ol class="grid gap-4 md:grid-cols-2">
        <li
          v-for="(_, i) in values"
          :key="i"
          class="flex flex-col gap-1 rounded-xl border-2 border-line-2 bg-surface p-4"
        >
          <label :for="`staff-card-${i}`" class="text-lg font-semibold">Card {{ i + 1 }}</label>
          <div class="flex gap-3">
            <input
              :id="`staff-card-${i}`"
              v-model="values[i]"
              :class="field"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              :aria-invalid="errors[i] !== null"
              :aria-describedby="errors[i] ? `staff-card-${i}-error` : undefined"
            />
            <button
              v-if="i < values.length - 1"
              type="button"
              :class="[tool, 'shrink-0']"
              :aria-label="`Fill the rest from card ${i + 1}`"
              :disabled="staffValue(values[i]!) === ''"
              @click="fill(i)"
            >
              Fill the rest
            </button>
          </div>
          <p
            v-if="errors[i]"
            :id="`staff-card-${i}-error`"
            class="text-lg font-semibold text-danger-text"
          >
            {{ errors[i] }}
          </p>
        </li>
      </ol>

      <div class="flex flex-wrap items-center gap-4">
        <button type="submit" :class="primary" :disabled="!ready">Generate PDF</button>
        <p class="text-lg text-ink-3">
          For Avery 5371 business cards. Print at <b>Actual size</b>, not "Fit to page".
        </p>
      </div>
    </form>
  </main>
</template>
