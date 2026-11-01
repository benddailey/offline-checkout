<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { MAX_NAME } from "../../log/limits";
import type { SessionSummary } from "../../store/db";
import logoUrl from "../../../icons/icon-round.svg";
import StartSessionForm from "../components/StartSessionForm.vue";
import WorkstationNameForm from "../components/WorkstationNameForm.vue";
import { useSession } from "../session";
import { otherWorkstations, type OtherWorkstation } from "../workstations";

/** An open session with no records for this long is not expanded, nor are its workstations listed. */
const STALE_MS = 72 * 60 * 60 * 1000;

const session = useSession();
const version = __APP_VERSION__;

const busy = ref(false);
const sessions = ref<SessionSummary[]>([]);
const others = ref<OtherWorkstation[]>([]);
/** Set once on load, so the layout doesn't change under the clerk. */
const recentOpen = ref(false);
const showStart = ref(false);
const renaming = ref(false);
/** Until this workstation has a name, naming it is all the page offers. */
const named = computed(() => typeof session.workstationName === "string");

const lastActivity = (s: SessionSummary) => s.lastActivityAt ?? s.createdAt;
const openSessions = computed(() =>
  sessions.value
    .filter((s) => s.closedAt === undefined)
    .sort((a, b) => lastActivity(b) - lastActivity(a)),
);
const closedSessions = computed(() => sessions.value.filter((s) => s.closedAt !== undefined));
const groups = computed(() =>
  !named.value
    ? []
    : recentOpen.value
      ? [
          { id: "open", title: "Open sessions", items: openSessions.value },
          { id: "closed", title: "Closed sessions", items: closedSessions.value },
        ].filter((g) => g.items.length > 0)
      : [{ id: "resume", title: "Resume", items: sessions.value }],
);

onMounted(async () => {
  session.loadWorkstationName().catch((err) => {
    console.error("launch: could not read the workstation name", err);
    session.workstationName = null;
  });
  try {
    sessions.value = await session.listSessions();
  } catch (err) {
    console.error("launch: could not list sessions", err);
    return;
  }
  others.value = otherWorkstations(sessions.value, Date.now() - STALE_MS);
  const latest = openSessions.value[0];
  if (latest && Date.now() - lastActivity(latest) <= STALE_MS) {
    recentOpen.value = true;
    expand(latest.sessionId);
  }
});

/** The open session whose clerk field is showing. */
const expanded = ref<string | null>(null);
const resumeClerk = ref("");
const resumeClerkError = ref(false);
const vFocus = { mounted: (el: HTMLElement) => el.focus() };

function expand(id: string | null) {
  expanded.value = id;
  resumeClerk.value = "";
  resumeClerkError.value = false;
  if (id !== null) showStart.value = false;
}

function toggleStart() {
  showStart.value = !showStart.value;
  if (showStart.value) expanded.value = null;
}

async function pick(s: SessionSummary) {
  if (busy.value) return;
  if (s.closedAt !== undefined) {
    busy.value = true;
    try {
      await session.resumeSession(s.sessionId);
    } finally {
      busy.value = false;
    }
    return;
  }
  expand(expanded.value === s.sessionId ? null : s.sessionId);
}

async function resume(id: string) {
  resumeClerkError.value = resumeClerk.value.trim() === "";
  if (resumeClerkError.value || busy.value) return;
  busy.value = true;
  try {
    await session.resumeSession(id, resumeClerk.value);
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
    <div class="flex flex-wrap items-center gap-4">
      <img :src="logoUrl" alt="" class="size-16" data-testid="app-logo" />
      <h1 class="text-4xl font-extrabold text-slate-900">Offline Checkout</h1>
      <span class="text-lg text-slate-600" data-testid="app-version">Version {{ version }}</span>
    </div>

    <div
      v-if="session.notice"
      role="status"
      class="flex flex-wrap items-center gap-4 rounded-lg border-l-8 border-blue-700 bg-blue-50 p-4 text-2xl font-semibold text-blue-900"
      data-testid="notice"
    >
      <span>{{ session.notice }}</span>
      <button type="button" :class="[secondary, 'ml-auto']" @click="session.notice = null">
        Dismiss
      </button>
    </div>

    <WorkstationNameForm v-if="session.workstationName === null" />
    <WorkstationNameForm
      v-else-if="renaming"
      :initial="session.workstationName"
      cancellable
      @done="renaming = false"
    />
    <p
      v-else-if="named"
      class="flex flex-wrap items-center gap-3 text-lg text-slate-700"
      data-testid="workstation"
    >
      <span
        >Workstation: <b class="text-slate-900">{{ session.workstationName }}</b></span
      >
      <button type="button" :class="[secondary, 'min-h-10 px-4 text-lg']" @click="renaming = true">
        Rename
      </button>
    </p>

    <div v-if="named && !recentOpen" class="grid gap-6 md:grid-cols-2">
      <StartSessionForm />

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

    <template v-for="g in groups" :key="g.id">
      <section
        class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
        :aria-labelledby="`${g.id}-title`"
      >
        <h2 :id="`${g.id}-title`" class="text-2xl font-bold">{{ g.title }}</h2>
        <p v-if="g.items.length === 0" class="text-lg text-slate-600">
          No sessions are stored on this workstation.
        </p>
        <ul v-else class="flex flex-col gap-2" data-testid="resume-list">
          <li v-for="s in g.items" :key="s.sessionId" class="flex flex-col gap-2">
            <button
              type="button"
              :class="[
                secondary,
                'flex w-full flex-wrap items-center justify-between gap-x-4 py-2 text-left',
                expanded === s.sessionId ? 'border-blue-700 bg-blue-50' : '',
              ]"
              :disabled="busy"
              :aria-expanded="s.closedAt === undefined ? expanded === s.sessionId : undefined"
              @click="pick(s)"
            >
              <span class="flex items-center gap-3">
                {{ s.name }}
                <span
                  v-if="s.closedAt !== undefined && !recentOpen"
                  class="rounded border-2 border-slate-500 bg-slate-100 px-2 text-base font-semibold text-slate-700"
                  data-testid="session-closed"
                >
                  Closed
                </span>
              </span>
              <span class="flex flex-col text-lg font-normal text-slate-600">
                <span>{{ s.employee }} · Started {{ new Date(s.createdAt).toLocaleString() }}</span>
                <span v-if="s.closedAt !== undefined">
                  Closed {{ new Date(s.closedAt).toLocaleString() }}
                </span>
              </span>
            </button>
            <form
              v-if="expanded === s.sessionId"
              class="flex flex-col gap-2 rounded-lg border-2 border-blue-700 bg-blue-50 p-4"
              :aria-label="`Resume ${s.name}`"
              data-testid="resume-form"
              @submit.prevent="resume(s.sessionId)"
            >
              <div class="flex flex-wrap items-end gap-3">
                <label class="flex min-w-64 flex-1 flex-col gap-1 text-lg font-semibold">
                  Clerk name
                  <input
                    v-focus
                    v-model="resumeClerk"
                    :class="field"
                    type="text"
                    autocomplete="off"
                    :maxlength="MAX_NAME"
                    :aria-invalid="resumeClerkError"
                    aria-describedby="resume-clerk-error"
                  />
                </label>
                <button type="submit" :class="primary" :disabled="busy">Resume session</button>
              </div>
              <p
                v-if="resumeClerkError"
                id="resume-clerk-error"
                class="text-lg font-semibold text-red-700"
              >
                Enter your name to resume.
              </p>
            </form>
          </li>
        </ul>
      </section>

      <template v-if="g.id === 'open'">
        <div class="flex flex-wrap gap-4">
          <button
            type="button"
            :class="[secondary, showStart ? 'border-blue-700 bg-blue-50' : '']"
            :aria-expanded="showStart"
            @click="toggleStart"
          >
            Start new session
          </button>
          <button type="button" :class="secondary" @click="session.screen = 'pair-join'">
            Join session
          </button>
        </div>
        <StartSessionForm v-if="showStart" autofocus />
      </template>
    </template>

    <section
      v-if="named && others.length > 0"
      class="flex flex-col gap-3 rounded-xl border-2 border-slate-300 bg-white p-5"
      aria-labelledby="others-title"
    >
      <h2 id="others-title" class="text-2xl font-bold">Other workstations</h2>
      <p class="text-lg text-slate-600">Last activity synced to this workstation.</p>
      <ul class="flex flex-col gap-2" data-testid="other-workstations">
        <li
          v-for="w in others"
          :key="w.deviceId"
          class="flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg border-2 border-slate-200 px-4 py-2 text-xl"
        >
          <b class="text-slate-900">{{ w.name }}</b>
          <span class="text-lg text-slate-600"
            >{{ w.sessionName }} · {{ new Date(w.lastAt).toLocaleString() }}</span
          >
        </li>
      </ul>
    </section>
  </main>
</template>
