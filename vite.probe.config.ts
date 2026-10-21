import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";
import { NOTICES_FILE, thirdPartyNotices } from "./scripts/third-party-notices";

// Separate single-file build of the field probe page (spec §5.5); keeps dist/ to the app and its notices.
export default defineConfig({
  root: "probe",
  plugins: lazyPlugins(() => [
    vue(),
    tailwindcss(),
    viteSingleFile(),
    thirdPartyNotices("Offline Checkout field probe"),
  ]),
  build: {
    outDir: "../dist-probe",
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    license: { fileName: NOTICES_FILE },
    rollupOptions: { input: "probe/probe.html" },
  },
});
