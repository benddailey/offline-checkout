<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { readBarcodes } from "zxing-wasm/reader";

const props = defineProps<{ paused: boolean }>();
const emit = defineEmits<{ detect: [text: string]; error: [] }>();

const FRAME_MS = 125;

const video = useTemplateRef<HTMLVideoElement>("video");
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
let stream: MediaStream | null = null;
let frame = 0;
let lastDecode = 0;
let decoding = false;
let unmounted = false;

onMounted(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    if (unmounted) return stopTracks(s);
    stream = s;
    const v = video.value!;
    v.srcObject = s;
    if (!props.paused) await v.play();
    frame = requestAnimationFrame(tick);
  } catch {
    if (!unmounted) emit("error");
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  cancelAnimationFrame(frame);
  if (stream) stopTracks(stream);
  stream = null;
  if (video.value) video.value.srcObject = null;
});

// Freezes the picture on the scanned frame, as the old scanner did.
watch(
  () => props.paused,
  (paused) => {
    const v = video.value;
    if (!v || !stream) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  },
);

function stopTracks(s: MediaStream) {
  for (const track of s.getTracks()) track.stop();
}

function tick(now: number) {
  frame = requestAnimationFrame(tick);
  if (props.paused || decoding || now - lastDecode < FRAME_MS) return;
  const v = video.value;
  if (!v || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !v.videoWidth) return;
  lastDecode = now;
  void decode(v);
}

async function decode(v: HTMLVideoElement) {
  decoding = true;
  try {
    if (canvas.width !== v.videoWidth) canvas.width = v.videoWidth;
    if (canvas.height !== v.videoHeight) canvas.height = v.videoHeight;
    ctx.drawImage(v, 0, 0);
    const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
      formats: ["QRCode"],
      maxNumberOfSymbols: 1,
    });
    if (unmounted || props.paused) return;
    const hit = results.find((r) => r.isValid && r.text.trim());
    if (hit) emit("detect", hit.text);
  } catch (e) {
    console.error("QR decode failed", e);
  } finally {
    decoding = false;
  }
}
</script>

<template>
  <video ref="video" class="h-full w-full object-cover" autoplay muted playsinline />
</template>
