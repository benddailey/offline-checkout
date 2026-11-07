<script setup lang="ts">
import { onMounted, ref } from "vue";
import { MAX_NAME } from "../../log/limits";
import { field, primary } from "../classes";
import { useSession, ymd } from "../session";

/** `autofocus`: opened by a Start new session button, which also serves as its heading. */
const props = defineProps<{ autofocus?: boolean }>();

const session = useSession();
const name = ref(ymd(new Date()));
const clerk = ref("");
const clerkError = ref(false);
const busy = ref(false);
const clerkInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  if (props.autofocus) clerkInput.value?.focus();
});

async function start() {
  clerkError.value = clerk.value.trim() === "";
  if (clerkError.value) clerkInput.value?.focus();
  if (clerkError.value || busy.value) return;
  busy.value = true;
  try {
    await session.startSession(name.value, clerk.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-4 rounded-xl border-2 border-line-2 bg-surface p-5"
    aria-label="Start new session"
    data-testid="start-form"
    @submit.prevent="start"
  >
    <h2 v-if="!autofocus" class="text-2xl font-bold">Start new session</h2>
    <label class="flex flex-col gap-1 text-lg font-semibold">
      Session name
      <input v-model="name" :class="field" type="text" autocomplete="off" :maxlength="MAX_NAME" />
    </label>
    <label class="flex flex-col gap-1 text-lg font-semibold">
      Clerk name
      <input
        ref="clerkInput"
        v-model="clerk"
        :class="field"
        type="text"
        autocomplete="off"
        :maxlength="MAX_NAME"
        :aria-invalid="clerkError"
        aria-describedby="clerk-error"
      />
    </label>
    <p v-if="clerkError" id="clerk-error" class="text-lg font-semibold text-danger-text">
      Enter your name to start.
    </p>
    <button type="submit" :class="primary" :disabled="busy">Start session</button>
  </form>
</template>
