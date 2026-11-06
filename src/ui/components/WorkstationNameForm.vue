<script setup lang="ts">
import { ref } from "vue";
import { MAX_NAME } from "../../log/limits";
import { field, primary, secondary } from "../classes";
import { useSession } from "../session";

const props = defineProps<{ initial?: string; cancellable?: boolean }>();
const emit = defineEmits<{ done: [] }>();

const session = useSession();
const name = ref(props.initial ?? "");
const nameError = ref(false);
const busy = ref(false);
const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) };

async function save() {
  nameError.value = name.value.trim() === "";
  if (nameError.value || busy.value) return;
  busy.value = true;
  try {
    if (await session.nameWorkstation(name.value)) emit("done");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-3 rounded-xl border-2 border-blue-700 bg-blue-50 p-5"
    aria-labelledby="workstation-title"
    data-testid="workstation-form"
    @submit.prevent="save"
  >
    <h2 id="workstation-title" class="text-2xl font-bold">
      {{ cancellable ? "Rename this workstation" : "Name this workstation" }}
    </h2>
    <p class="text-lg text-slate-700">
      Every scan made here is recorded with this name, beside the clerk's, so the exports show which
      computer it was made on. For example: <b>Front desk 1</b>.
    </p>
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex min-w-64 flex-1 flex-col gap-1 text-lg font-semibold">
        Workstation name
        <input
          v-focus
          v-model="name"
          :class="field"
          type="text"
          autocomplete="off"
          :maxlength="MAX_NAME"
          :aria-invalid="nameError"
          aria-describedby="workstation-error"
        />
      </label>
      <button type="submit" :class="primary" :disabled="busy">Save</button>
      <button v-if="cancellable" type="button" :class="secondary" @click="emit('done')">
        Cancel
      </button>
    </div>
    <p v-if="nameError" id="workstation-error" class="text-lg font-semibold text-red-700">
      Enter a name for this workstation.
    </p>
    <p
      v-else-if="session.message?.tone === 'error'"
      class="text-lg font-semibold text-red-700"
      role="alert"
    >
      {{ session.message.text }}
    </p>
  </form>
</template>
