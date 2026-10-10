<script setup lang="ts">
import { useSession } from "../session";

const session = useSession();
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-2 border-slate-300 bg-slate-100 px-4 py-2"
    data-testid="status-bar"
  >
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
    <p v-if="session.isolated" class="text-lg font-semibold text-red-700">
      Disconnected — re-pair with any workstation
    </p>
    <p class="ml-auto text-xl font-bold text-slate-900" data-testid="totals">
      Patrons {{ session.state.totals.patrons }} · Items {{ session.state.totals.items }}
    </p>
    <div class="flex gap-2">
      <button
        type="button"
        class="min-h-11 rounded-lg border-2 border-slate-700 bg-white px-4 text-lg font-semibold hover:bg-slate-200"
        @click="session.screen = 'pair-invite'"
      >
        Add workstation
      </button>
      <button
        type="button"
        class="min-h-11 rounded-lg border-2 border-slate-700 bg-white px-4 text-lg font-semibold hover:bg-slate-200"
        @click="session.screen = 'summary'"
      >
        Summary
      </button>
    </div>
  </header>
</template>
