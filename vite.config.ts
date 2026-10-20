import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// https://vite.dev/config/
export default defineConfig({
  fmt: { ignorePatterns: ["docs/**", ".superpowers/**", ".claude/**"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: lazyPlugins(() => [
    vue(),
    tailwindcss(),
    viteSingleFile(),
    {
      name: "app-version",
      transformIndexHtml: (html) => html.replace("{{APP_VERSION}}", version),
    },
  ]),
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
