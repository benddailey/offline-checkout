import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vite.dev/config/
export default defineConfig({
  fmt: { ignorePatterns: ["docs/**", ".superpowers/**", ".claude/**"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [vue(), tailwindcss(), viteSingleFile()]),
  build: {
    assetsInlineLimit: () => true,
    rollupOptions: { input: "offline-checkout.html" },
  },
  test: {
    include: ["src/**/*.test.ts", "probe/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
