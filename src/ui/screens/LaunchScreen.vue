<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { SessionSummary } from "../../store/db";
import { useSession, ymd } from "../session";

const session = useSession();

const name = ref(ymd(new Date()));
const clerk = ref("");
const clerkError = ref(false);
const busy = ref(false);
const sessions = ref<SessionSummary[]>([]);

onMounted(async () => {
  try {
    sessions.value = await session.listSessions();
  } catch (err) {
    console.error("launch: could not list sessions", err);
  }
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

async function resume(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await session.resumeSession(id);
  } finally {
    busy.value = false;
  }
}

const field =
  "block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none";
const primary =
  "min-h-12 rounded-lg border-2 border-blue-800 bg-blue-700 px-6 text-xl font-semibold text-white hover:bg-blue-800 disabled:opacity-50";
const secondary =
  "min-h-12 rounded-lg border-2 border-slate-700 bg-white px-6 text-xl font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50";
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
    <h1 class="text-4xl font-extrabold text-slate-900">Offline Checkout</h1>

    <div class="grid gap-6 md:grid-cols-2">
      <form
        class="flex flex-col gap-4 rounded-xl border-2 border-slate-300 bg-white p-5"
        aria-labelledby="start-title"
        @submit.prevent="start"
      >
        <h2 id="start-title" class="text-2xl font-bold">Start new session</h2>
        <label class="flex flex-col gap-1 text-lg font-semibold">
          Session name
          <input v-model="name" :class="field" type="text" autocomplete="off" />
        </label>
        <label class="flex flex-col gap-1 text-lg font-semibold">
          Clerk name
          <input
            v-model="clerk"
            :class="field"
            type="text"
            autocomplete="off"
            :aria-invalid="clerkError"
            aria-describedby="clerk-error"
          />
        </label>
        <p v-if="clerkError" id="clerk-error" class="text-lg font-semibold text-red-700">
          Enter your name to start.
        </p>
        <button type="submit" :class="primary" :disabled="busy">Start session</button>
      </form>

      <section
        class="flex flex-col gap-4 rounded-xl border-2 border-slate-300 bg-white p-5"
        aria-labelledby="join-title"
      >
        <h2 id="join-title" class="text-2xl font-bold">Join session</h2>
        <p class="text-lg text-slate-700">
          Join a session already running on another workstation by scanning its pairing code.
        </p>
        <button type="button" :class="secondary" @click="session.screen = 'pair-join'">
          Join session
        </button>
      </section>
    </div>

    <section
      class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
      aria-labelledby="resume-title"
    >
      <h2 id="resume-title" class="text-2xl font-bold">Resume</h2>
      <p v-if="sessions.length === 0" class="text-lg text-slate-600">
        No sessions are stored on this workstation.
      </p>
      <ul v-else class="flex flex-col gap-2" data-testid="resume-list">
        <li v-for="s in sessions" :key="s.sessionId">
          <button
            type="button"
            :class="[secondary, 'flex w-full items-center justify-between text-left']"
            :disabled="busy"
            @click="resume(s.sessionId)"
          >
            <span>{{ s.name }}</span>
            <span class="text-lg font-normal text-slate-600">
              {{ s.employee }} · {{ new Date(s.createdAt).toLocaleString() }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
