<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { MAX_NAME } from "../../log/limits";
import type { SessionSummary } from "../../store/db";
import logoUrl from "../../../icons/icon-round.svg";
import StartSessionForm from "../components/StartSessionForm.vue";
import ThemeButton from "../components/ThemeButton.vue";
import WorkstationNameForm from "../components/WorkstationNameForm.vue";
import { field, primary, secondary, secondaryOn, tool } from "../classes";
import { useSession } from "../session";
import { dateTime } from "../when";
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

async function resume(id: string, form: HTMLFormElement) {
  resumeClerkError.value = resumeClerk.value.trim() === "";
  if (resumeClerkError.value) form.querySelector("input")?.focus();
  if (resumeClerkError.value || busy.value) return;
  busy.value = true;
  try {
    await session.resumeSession(id, resumeClerk.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
    <div class="flex flex-wrap items-center gap-4">
      <img :src="logoUrl" alt="" class="size-16" data-testid="app-logo" />
      <h1 class="text-4xl font-extrabold text-ink">Offline Checkout</h1>
      <span class="text-lg text-ink-4" data-testid="app-version">Version {{ version }}</span>
      <ThemeButton class="ml-auto" />
    </div>

    <div
      v-if="session.notice"
      role="status"
      class="flex flex-wrap items-center gap-4 rounded-lg border-l-8 border-accent bg-accent-soft p-4 text-2xl font-semibold text-accent-ink"
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
      class="flex flex-wrap items-center gap-3 text-lg text-ink-3"
      data-testid="workstation"
    >
      <span
        >Workstation: <b class="text-ink">{{ session.workstationName }}</b></span
      >
      <button type="button" :class="tool" @click="renaming = true">Rename</button>
      <button type="button" :class="[tool, 'ml-auto']" @click="session.screen = 'staff-cards'">
        Print staff barcodes
      </button>
    </p>

    <div v-if="named && !recentOpen" class="grid gap-6 md:grid-cols-2">
      <StartSessionForm />

      <section
        class="flex flex-col gap-4 rounded-xl border-2 border-line-2 bg-surface p-5"
        aria-labelledby="join-title"
      >
        <h2 id="join-title" class="text-2xl font-bold">Join session</h2>
        <p class="text-lg text-ink-3">
          Join a session already running on another workstation by scanning its pairing code.
        </p>
        <button type="button" :class="[secondary, 'mt-auto']" @click="session.screen = 'pair-join'">
          Join session
        </button>
      </section>
    </div>

    <template v-for="g in groups" :key="g.id">
      <section
        class="flex flex-col gap-3 rounded-xl border-2 border-line-2 bg-surface p-5"
        :aria-labelledby="`${g.id}-title`"
      >
        <h2 :id="`${g.id}-title`" class="text-2xl font-bold">{{ g.title }}</h2>
        <p v-if="g.items.length === 0" class="text-lg text-ink-4">
          No sessions are stored on this workstation.
        </p>
        <ul v-else class="flex flex-col gap-2" data-testid="resume-list">
          <li v-for="s in g.items" :key="s.sessionId" class="flex flex-col gap-2">
            <button
              type="button"
              :class="[
                expanded === s.sessionId ? secondaryOn : secondary,
                'flex w-full flex-wrap items-center justify-between gap-x-4 py-2 text-left',
              ]"
              :disabled="busy"
              :aria-expanded="s.closedAt === undefined ? expanded === s.sessionId : undefined"
              @click="pick(s)"
            >
              <span class="flex items-center gap-3">
                {{ s.name }}
                <span
                  v-if="s.closedAt !== undefined && !recentOpen"
                  class="rounded border-2 border-line-4 bg-raised px-2 text-base font-semibold text-ink-3"
                  data-testid="session-closed"
                >
                  Closed
                </span>
              </span>
              <span class="flex flex-col text-lg font-normal text-ink-4">
                <span>{{ s.employee }} · Started {{ dateTime(s.createdAt) }}</span>
                <span v-if="s.closedAt !== undefined"> Closed {{ dateTime(s.closedAt) }} </span>
              </span>
            </button>
            <form
              v-if="expanded === s.sessionId"
              class="flex flex-col gap-2 rounded-lg border-2 border-accent bg-accent-soft p-4"
              :aria-label="`Resume ${s.name}`"
              data-testid="resume-form"
              @submit.prevent="resume(s.sessionId, $event.target as HTMLFormElement)"
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
                class="text-lg font-semibold text-danger-text"
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
            :class="showStart ? secondaryOn : secondary"
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
      class="flex flex-col gap-3 rounded-xl border-2 border-line-2 bg-surface p-5"
      aria-labelledby="others-title"
    >
      <h2 id="others-title" class="text-2xl font-bold">Other workstations</h2>
      <p class="text-lg text-ink-4">Last activity synced to this workstation.</p>
      <ul class="flex flex-col gap-2" data-testid="other-workstations">
        <li
          v-for="w in others"
          :key="w.deviceId"
          class="flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg border-2 border-line-1 px-4 py-2 text-xl"
        >
          <b class="text-ink">{{ w.name }}</b>
          <span class="text-lg text-ink-4">{{ w.sessionName }} · {{ dateTime(w.lastAt) }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>
