<script setup lang="ts">
import FatalAlert from "./ui/components/FatalAlert.vue";
import StatusBar from "./ui/components/StatusBar.vue";
import LaunchScreen from "./ui/screens/LaunchScreen.vue";
import ScanScreen from "./ui/screens/ScanScreen.vue";
import { useSession } from "./ui/session";

const session = useSession();

/** Pairing (Task 12) and summary (Task 13) screens are not built yet. */
const placeholders = {
  "pair-invite": "Add workstation",
  "pair-join": "Join session",
  summary: "Session summary",
} as const;
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <StatusBar v-if="session.screen === 'scan' || session.screen === 'summary'" />
    <LaunchScreen v-if="session.screen === 'launch'" />
    <ScanScreen v-else-if="session.screen === 'scan'" />
    <main v-else class="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 class="text-3xl font-bold">{{ placeholders[session.screen] }}</h1>
      <p class="text-xl text-slate-700">Not available yet.</p>
      <button
        type="button"
        class="min-h-12 self-start rounded-lg border-2 border-slate-700 bg-white px-6 text-xl font-semibold"
        @click="session.screen = session.meta ? 'scan' : 'launch'"
      >
        Back
      </button>
    </main>
    <FatalAlert v-if="session.fatal" :text="session.fatal" />
  </div>
</template>
