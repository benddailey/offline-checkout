<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import FatalAlert from "./ui/components/FatalAlert.vue";
import StatusBar from "./ui/components/StatusBar.vue";
import LaunchScreen from "./ui/screens/LaunchScreen.vue";
import PairScreen from "./ui/screens/PairScreen.vue";
import ScanScreen from "./ui/screens/ScanScreen.vue";
import SummaryScreen from "./ui/screens/SummaryScreen.vue";
import { useSession } from "./ui/session";

const session = useSession();

/** Closing or reloading the tab mid-patron asks first (Chrome shows its own generic prompt). */
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (session.lockedPatron) e.preventDefault();
}
onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload));
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <StatusBar v-if="session.screen === 'scan' || session.screen === 'summary'" />
    <LaunchScreen v-if="session.screen === 'launch'" />
    <ScanScreen v-else-if="session.screen === 'scan'" />
    <PairScreen v-else-if="session.screen === 'pair-invite'" key="invite" mode="invite" />
    <PairScreen v-else-if="session.screen === 'pair-join'" key="join" mode="join" />
    <SummaryScreen v-else-if="session.screen === 'summary'" />
    <FatalAlert v-if="session.fatal" :text="session.fatal" />
  </div>
</template>
