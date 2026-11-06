<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { MAX_NAME } from "../../log/limits";
import {
  danger,
  dialogBox,
  dialogOverlay,
  field,
  primary,
  secondary,
  tool,
  toolDanger,
} from "../classes";
import { useSession } from "../session";

const session = useSession();

const dialog = ref<"clerk" | "exit" | null>(null);
watch(dialog, (d) => (session.toolbarDialog = d !== null));
watch(
  () => session.closed,
  (c) => c && dialog.value === "clerk" && (dialog.value = null),
);

const clerk = ref("");
const clerkError = ref(false);
const saving = ref(false);
const clerkInput = useTemplateRef<HTMLInputElement>("clerkInput");
const cancelButton = useTemplateRef<HTMLButtonElement>("cancel");
const box = useTemplateRef<HTMLElement>("box");

/** Leaving drops the links to other workstations; they come back only by re-pairing. */
const linked = computed(() => session.peers.some((p) => p.connected));

async function changeClerk(): Promise<void> {
  clerk.value = "";
  clerkError.value = false;
  dialog.value = "clerk";
  await nextTick();
  clerkInput.value?.focus();
}

async function saveClerk(): Promise<void> {
  clerkError.value = clerk.value.trim() === "";
  if (clerkError.value || saving.value) return;
  saving.value = true;
  try {
    if (await session.changeClerk(clerk.value)) dialog.value = null;
  } finally {
    saving.value = false;
  }
}

async function exit(): Promise<void> {
  if (!linked.value) {
    session.leaveSession();
    return;
  }
  dialog.value = "exit";
  await nextTick();
  cancelButton.value?.focus();
}

/** Keep Tab and Shift+Tab inside the dialog. */
function trapTab(e: KeyboardEvent): void {
  const items = [...(box.value?.querySelectorAll<HTMLElement>("input, button") ?? [])];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !box.value?.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !box.value?.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <header
    class="flex flex-col gap-2 border-b-2 border-slate-300 bg-slate-100 px-4 py-2"
    data-testid="status-bar"
  >
    <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
      <div class="font-bold text-slate-900">
        {{ session.meta?.name }}
        <span class="font-normal text-slate-600">· {{ session.meta?.employee }}</span>
      </div>
      <ul class="flex flex-wrap items-center gap-4" aria-label="Workstations">
        <li v-for="p in session.peers" :key="p.deviceId" class="flex items-center gap-2 text-lg">
          <span
            class="inline-block size-4 rounded-full"
            :class="p.connected ? 'bg-green-600' : 'bg-red-600'"
            :aria-label="p.connected ? 'connected' : 'disconnected'"
          ></span>
          {{ p.employee }}
        </li>
      </ul>
      <p v-if="session.disconnected" class="text-lg font-semibold text-red-700">
        Disconnected — re-pair with any workstation
      </p>
      <p class="ml-auto text-xl font-bold text-slate-900" data-testid="totals">
        Patrons {{ session.state.totals.patrons }} · Items {{ session.state.totals.items }}
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div class="flex flex-wrap gap-2">
        <button
          v-if="session.disconnected"
          type="button"
          :class="toolDanger"
          :disabled="session.lockedPatron !== null"
          :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
          @click="session.screen = 'pair-join'"
        >
          Re-pair
        </button>
        <button
          type="button"
          :class="tool"
          :disabled="session.lockedPatron !== null"
          :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
          @click="session.screen = 'pair-invite'"
        >
          Add workstation
        </button>
        <button
          type="button"
          :class="tool"
          :disabled="session.lockedPatron !== null"
          :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
          @click="session.screen = 'summary'"
        >
          Summary
        </button>
        <button
          v-if="!session.closed"
          type="button"
          :class="tool"
          :disabled="session.lockedPatron !== null"
          :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
          @click="changeClerk"
        >
          Change clerk
        </button>
        <button
          type="button"
          :class="tool"
          :disabled="session.lockedPatron !== null || session.deletingSession"
          :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
          @click="exit"
        >
          Exit session
        </button>
      </div>
      <p
        v-if="session.lockedPatron"
        id="finish-patron"
        class="ml-auto text-lg font-semibold text-slate-700"
        data-testid="finish-patron"
      >
        Finish patron {{ session.lockedPatron }} first: End patron or Void patron
      </p>
    </div>

    <div v-if="dialog" :class="dialogOverlay" @keydown.esc="dialog = null" @keydown.tab="trapTab">
      <form
        v-if="dialog === 'clerk'"
        ref="box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clerk-title"
        :class="[dialogBox, 'w-full max-w-xl border-blue-700']"
        @submit.prevent="saveClerk"
      >
        <h2 id="clerk-title" class="text-3xl font-extrabold">Change clerk</h2>
        <p class="text-2xl">Scans from now on are recorded under the new name.</p>
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
            aria-describedby="change-clerk-error"
          />
        </label>
        <p v-if="clerkError" id="change-clerk-error" class="text-lg font-semibold text-red-700">
          Enter your name.
        </p>
        <div class="flex flex-wrap gap-3">
          <button type="submit" :class="primary" :disabled="saving">Change clerk</button>
          <button type="button" :class="secondary" @click="dialog = null">Cancel</button>
        </div>
      </form>
      <div
        v-else
        ref="box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-title"
        aria-describedby="exit-text"
        :class="[dialogBox, 'max-w-xl border-red-700']"
      >
        <h2 id="exit-title" class="text-3xl font-extrabold">Exit session</h2>
        <p id="exit-text" class="text-2xl">
          This workstation will disconnect from the others. To scan here again, resume the session
          and re-pair with any workstation.
        </p>
        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            :class="danger"
            :disabled="session.deletingSession"
            @click="session.leaveSession()"
          >
            Yes, exit session
          </button>
          <button ref="cancel" type="button" :class="secondary" @click="dialog = null">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
