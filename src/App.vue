<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import FatalAlert from "./ui/components/FatalAlert.vue";
import StatusBar from "./ui/components/StatusBar.vue";
import LaunchScreen from "./ui/screens/LaunchScreen.vue";
import PairScreen from "./ui/screens/PairScreen.vue";
import ScanScreen from "./ui/screens/ScanScreen.vue";
import SummaryScreen from "./ui/screens/SummaryScreen.vue";
import { usePanelDrag } from "./ui/panel";
import { useSession } from "./ui/session";
import { currentBackground } from "./ui/theme";

const session = useSession();

/** Closing or reloading the tab mid-patron asks first (Chrome shows its own generic prompt). */
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (session.lockedPatron) e.preventDefault();
}
onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload));

const root = useTemplateRef<HTMLElement>("root");
const drag = usePanelDrag(root, () => currentBackground.value !== "none");
watch(() => [session.screen, currentBackground.value], drag.relayout, { flush: "post" });
</script>

<template>
  <div
    ref="root"
    class="min-h-screen bg-page backdrop text-ink"
    @pointerdown="drag.onPointerDown"
    @dblclick="drag.onDoubleClick"
  >
    <StatusBar v-if="session.screen === 'scan' || session.screen === 'summary'" />
    <LaunchScreen v-if="session.screen === 'launch'" />
    <ScanScreen v-else-if="session.screen === 'scan'" />
    <PairScreen v-else-if="session.screen === 'pair-invite'" key="invite" mode="invite" />
    <PairScreen v-else-if="session.screen === 'pair-join'" key="join" mode="join" />
    <SummaryScreen v-else-if="session.screen === 'summary'" />
    <FatalAlert v-if="session.fatal" :text="session.fatal" />
  </div>
</template>
