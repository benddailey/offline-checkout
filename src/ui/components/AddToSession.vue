<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import type { ImportSource } from "../../import/plan";
import type { FileRejection, FileSource } from "../../import/rows";
import { MAX_NAME, clampName } from "../../log/limits";
import type { SessionSummary } from "../../store/db";
import { trapTab } from "../focus-trap";
import { importLine, previewWarnings, sourceHeading, sourceLine } from "../import-preview";
import { useSession } from "../session";

const session = useSession();

const others = ref<SessionSummary[]>([]);
/** The accepted sources of the open preview; null while no preview is open. */
const sources = shallowRef<ImportSource[] | null>(null);
const rejected = ref<FileRejection[]>([]);
const clerk = ref("");
const loading = ref(false);
const adding = ref(false);
let alive = true;

const dialog = useTemplateRef<HTMLElement>("dialog");
const nameInput = useTemplateRef<HTMLInputElement>("nameInput");
const closeButton = useTemplateRef<HTMLButtonElement>("closeButton");
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");

/** Follows the log while the preview is open, so what it shows is what adding would do. */
const plan = computed(() => (sources.value?.length ? session.previewImport(sources.value) : null));
const ready = computed(() => plan.value?.anythingNew === true);
const nothingNew = computed(() => plan.value !== null && !ready.value);
const warnings = computed(() => (ready.value ? previewWarnings(plan.value!, time, date) : []));
const imports = computed(() => session.state.imports.map((i) => importLine(i, time)));

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function date(at: number): string {
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

async function reload(): Promise<void> {
  try {
    const list = await session.otherSessions();
    if (alive) others.value = list;
  } catch (err) {
    console.error("add to session: could not list sessions", err);
    // Never over the result of the add that this reload follows.
    if (alive) {
      session.message ??= { tone: "error", text: "Could not list the other sessions on this PC." };
    }
  }
}

function focusFirst(): void {
  (nameInput.value ?? closeButton.value)?.focus();
}

async function openPreview(accepted: ImportSource[], refused: FileRejection[]): Promise<void> {
  clerk.value = "";
  rejected.value = refused;
  sources.value = accepted;
  session.toolbarDialog = true;
  await nextTick();
  focusFirst();
}

function closePreview(): void {
  sources.value = null;
  rejected.value = [];
  clerk.value = "";
  session.toolbarDialog = false;
  void reload();
}

function dismiss(): void {
  if (!adding.value) closePreview();
}

// The name field goes when the log catches up with the sources, taking focus with it.
watch(ready, focusFirst, { flush: "post" });

async function chooseSession(summary: SessionSummary): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const source = await session.loadSessionSource(summary);
    if (alive) await openPreview([source], []);
  } catch (err) {
    console.error("add to session: could not read the session", err);
    if (!alive) return;
    session.message = {
      tone: "error",
      text: `Could not read that session (${summary.name}), so nothing was added. It may have been deleted.`,
    };
    void reload();
  } finally {
    loading.value = false;
  }
}

async function chooseFiles(files: File[]): Promise<void> {
  if (loading.value || files.length === 0) return;
  loading.value = true;
  try {
    const read = await session.readFiles(files);
    if (!alive) return;
    const accepted: FileSource[] = [];
    const refused: FileRejection[] = [];
    for (const r of read) {
      if ("kind" in r) accepted.push(r);
      else refused.push(r);
    }
    await openPreview(accepted, refused);
  } finally {
    loading.value = false;
  }
}

function onFilesChosen(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  void chooseFiles(files);
}

function onDrop(e: DragEvent): void {
  void chooseFiles([...(e.dataTransfer?.files ?? [])]);
}

async function add(): Promise<void> {
  if (!sources.value || adding.value) return;
  adding.value = true;
  try {
    const added = await session.addToSession(sources.value, clerk.value);
    if (!alive) return;
    // Not added, yet still something new: it failed, and the banner behind the dialog says why.
    if (added || ready.value) closePreview();
  } finally {
    adding.value = false;
  }
}

function blockFileDrop(e: DragEvent): void {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
}

onMounted(() => {
  window.addEventListener("dragover", blockFileDrop);
  window.addEventListener("drop", blockFileDrop);
  void reload();
});

onUnmounted(() => {
  alive = false;
  window.removeEventListener("dragover", blockFileDrop);
  window.removeEventListener("drop", blockFileDrop);
  session.toolbarDialog = false;
});

const button =
  "min-h-12 rounded-lg border-2 px-5 text-xl font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} border-blue-800 bg-blue-700 text-white hover:bg-blue-800 disabled:hover:bg-blue-700`;
const secondary = `${button} border-slate-700 bg-white text-slate-900 hover:bg-slate-100 disabled:hover:bg-white`;
</script>

<template>
  <section class="flex flex-col gap-4 rounded-xl border-2 border-slate-300 bg-white p-5">
    <h2 class="text-2xl font-bold">Add to this session</h2>

    <div class="flex flex-col items-start gap-2" data-testid="other-sessions">
      <h3 class="text-lg font-bold text-slate-700">Add another session</h3>
      <p v-if="others.length === 0" class="text-lg text-slate-600">No other sessions on this PC.</p>
      <ul v-else class="flex w-full flex-col gap-2">
        <li v-for="s in others" :key="s.sessionId">
          <button
            type="button"
            :class="secondary"
            class="w-full text-left"
            :disabled="loading"
            @click="chooseSession(s)"
          >
            {{ s.name }}
            <span class="font-normal text-slate-600">
              · Started {{ new Date(s.createdAt).toLocaleString() }} ·
              {{ s.closedAt === undefined ? "open" : "closed" }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div class="flex flex-col items-start gap-2">
      <h3 class="text-lg font-bold text-slate-700">Add exported files</h3>
      <div
        class="flex w-full flex-wrap items-center gap-4 rounded-lg border-2 border-dashed border-slate-500 bg-slate-50 p-4"
        data-testid="add-drop-zone"
        @drop="onDrop"
      >
        <p class="text-lg">Drop CSV, Excel or Evergreen files here, or</p>
        <button type="button" :class="secondary" :disabled="loading" @click="fileInput?.click()">
          Choose files
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          data-testid="add-files"
          @change="onFilesChosen"
        />
      </div>
    </div>

    <div v-if="imports.length" class="flex flex-col gap-2">
      <h3 class="text-lg font-bold text-slate-700">Added to this session</h3>
      <ul class="text-lg" data-testid="added-list">
        <li v-for="(line, i) in imports" :key="i">{{ line }}</li>
      </ul>
    </div>

    <div
      v-if="sources"
      class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-6 outline-none"
      tabindex="-1"
      @keydown.esc="dismiss"
      @keydown.tab="trapTab(dialog, $event)"
    >
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        class="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl border-4 border-blue-700 bg-white p-6"
      >
        <h2 id="add-title" class="text-3xl font-extrabold">Add to this session</h2>

        <ul v-if="ready" class="flex flex-col gap-3" data-testid="add-sources">
          <li v-for="(p, i) in plan!.sources" :key="i" class="text-xl">
            <p class="font-bold break-words">{{ sourceHeading(p, date) }}</p>
            <p>{{ sourceLine(p) }}</p>
          </li>
        </ul>

        <template v-if="rejected.length">
          <ul
            class="flex flex-col gap-2 rounded-lg border-l-8 border-red-700 bg-red-100 p-3 text-xl text-red-900"
            data-testid="add-rejected"
          >
            <li v-for="(r, i) in rejected" :key="i">
              <span class="font-bold break-words">{{ r.name }}:</span> {{ r.reason }}
            </li>
          </ul>
          <p v-if="ready" class="text-xl font-semibold">The other files can still be added.</p>
        </template>

        <p v-if="nothingNew" class="text-2xl font-semibold" data-testid="add-nothing-new">
          Nothing new to add. Everything here is already in this session.
        </p>

        <ul
          v-if="warnings.length"
          class="flex flex-col gap-2 rounded-lg border-l-8 border-amber-600 bg-amber-100 p-3 text-xl text-amber-950"
          data-testid="add-warnings"
        >
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>

        <label v-if="ready" class="flex flex-col gap-1 text-lg font-semibold">
          Your name
          <input
            ref="nameInput"
            v-model="clerk"
            class="block min-h-12 w-full rounded-lg border-2 border-slate-500 bg-white px-3 text-xl focus:border-blue-700 focus:ring-4 focus:ring-blue-300 focus:outline-none"
            type="text"
            autocomplete="off"
            aria-required="true"
            :maxlength="MAX_NAME"
          />
        </label>

        <div v-if="ready" class="flex flex-wrap gap-3">
          <button
            type="button"
            :class="primary"
            :disabled="clampName(clerk) === '' || adding"
            @click="add"
          >
            Add to session
          </button>
          <button type="button" :class="secondary" :disabled="adding" @click="closePreview">
            Cancel
          </button>
        </div>
        <div v-else>
          <button ref="closeButton" type="button" :class="secondary" @click="closePreview">
            Close
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
