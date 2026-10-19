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
    <div v-if="session.disconnected" class="flex items-center gap-3">
      <p class="text-lg font-semibold text-red-700">Disconnected — re-pair with any workstation</p>
      <button
        type="button"
        class="min-h-11 rounded-lg border-2 border-red-700 bg-white px-4 text-lg font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:opacity-40"
        :disabled="session.lockedPatron !== null"
        :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
        @click="session.screen = 'pair-join'"
      >
        Re-pair
      </button>
    </div>
    <p class="ml-auto text-xl font-bold text-slate-900" data-testid="totals">
      Patrons {{ session.state.totals.patrons }} · Items {{ session.state.totals.items }}
    </p>
    <p
      v-if="session.lockedPatron"
      id="finish-patron"
      class="text-lg font-semibold text-slate-700"
      data-testid="finish-patron"
    >
      Finish patron {{ session.lockedPatron }} first: End patron or Void patron
    </p>
    <div class="flex gap-2">
      <button
        type="button"
        class="min-h-11 rounded-lg border-2 border-slate-700 bg-white px-4 text-lg font-semibold hover:bg-slate-200 disabled:cursor-not-allowed disabled:hover:bg-white disabled:opacity-40"
        :disabled="session.lockedPatron !== null"
        :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
        @click="session.screen = 'pair-invite'"
      >
        Add workstation
      </button>
      <button
        type="button"
        class="min-h-11 rounded-lg border-2 border-slate-700 bg-white px-4 text-lg font-semibold hover:bg-slate-200 disabled:cursor-not-allowed disabled:hover:bg-white disabled:opacity-40"
        :disabled="session.lockedPatron !== null"
        :aria-describedby="session.lockedPatron ? 'finish-patron' : undefined"
        @click="session.screen = 'summary'"
      >
        Summary
      </button>
    </div>
  </header>
</template>
