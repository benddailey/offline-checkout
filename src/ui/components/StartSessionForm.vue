<script setup lang="ts">
import { onMounted, ref } from "vue";
import { MAX_NAME } from "../../log/limits";
import { useSession, ymd } from "../session";

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
  if (clerkError.value || busy.value) return;
  busy.value = true;
  try {
    await session.startSession(name.value, clerk.value);
  } finally {
    busy.value = false;
  }
}

const field =
  "block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none";
const primary =
  "min-h-12 rounded-lg border-2 border-blue-800 bg-blue-700 px-6 text-xl font-semibold text-white hover:bg-blue-800 disabled:opacity-50";
</script>

<template>
  <form
    class="flex flex-col gap-4 rounded-xl border-2 border-slate-300 bg-white p-5"
    aria-labelledby="start-title"
    data-testid="start-form"
    @submit.prevent="start"
  >
    <h2 id="start-title" class="text-2xl font-bold">Start new session</h2>
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
    <p v-if="clerkError" id="clerk-error" class="text-lg font-semibold text-red-700">
      Enter your name to start.
    </p>
    <button type="submit" :class="primary" :disabled="busy">Start session</button>
  </form>
</template>
