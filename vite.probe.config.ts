import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";

// Separate single-file build of the field probe page (spec §5.5); keeps dist/ at exactly one file.
export default defineConfig({
  root: "probe",
  plugins: lazyPlugins(() => [vue(), tailwindcss(), viteSingleFile()]),
  build: {
    outDir: "../dist-probe",
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    rollupOptions: { input: "probe/probe.html" },
  },
});
