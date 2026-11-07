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
  toolOn,
} from "../classes";
import { useSession } from "../session";
import ThemeButton from "./ThemeButton.vue";

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
  if (clerkError.value) clerkInput.value?.focus();
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
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-2 border-line-2 bg-raised px-4 py-2"
    data-testid="status-bar"
  >
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
        :class="session.screen === 'summary' ? toolOn : tool"
        :disabled="session.lockedPatron !== null"
        :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
        :aria-current="session.screen === 'summary' ? 'page' : undefined"
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
      <ThemeButton />
    </div>
    <ul
      v-if="session.peers.length"
      class="flex flex-wrap items-center gap-4"
      aria-label="Workstations"
    >
      <li v-for="p in session.peers" :key="p.deviceId" class="flex items-center gap-2 text-lg">
        <span
          role="img"
          class="inline-block size-4 rounded-full"
          :class="p.connected ? 'bg-online' : 'bg-offline'"
          :aria-label="p.connected ? 'connected' : 'disconnected'"
        ></span>
        {{ p.employee }}
        <template v-if="session.workstationNames.get(p.deviceId)">
          ({{ session.workstationNames.get(p.deviceId)?.workstation }})
        </template>
        <span v-if="!p.connected" class="font-semibold text-danger-text-2">not connected</span>
      </li>
    </ul>
    <p v-if="session.disconnected" class="text-lg font-semibold text-danger-text">
      Disconnected — re-pair with any workstation
    </p>
    <div class="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
      <div class="text-lg font-bold text-ink">
        {{ session.meta?.name }}
        <span class="text-lg font-semibold text-ink-2" data-testid="clerk">
          · {{ session.meta?.employee }}
        </span>
      </div>
      <span aria-hidden="true" class="w-0.5 self-stretch rounded-full bg-line-3"></span>
      <p class="text-xl font-bold text-ink" data-testid="totals">
        Patrons {{ session.state.totals.patrons }} · Items {{ session.state.totals.items }}
      </p>
    </div>
    <div
      v-if="dialog"
      :class="dialogOverlay"
      tabindex="-1"
      @keydown.esc="dialog = null"
      @keydown.tab="trapTab"
    >
      <form
        v-if="dialog === 'clerk'"
        ref="box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clerk-title"
        :class="[dialogBox, 'w-full max-w-xl border-accent']"
        @submit.prevent="saveClerk"
      >
        <h2 id="clerk-title" class="text-3xl font-extrabold">Change clerk</h2>
        <p class="text-xl">Scans from now on are recorded under the new name.</p>
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
        <p v-if="clerkError" id="change-clerk-error" class="text-lg font-semibold text-danger-text">
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
        :class="[dialogBox, 'max-w-xl border-danger-line']"
      >
        <h2 id="exit-title" class="text-3xl font-extrabold">Exit session</h2>
        <p id="exit-text" class="text-xl">
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
