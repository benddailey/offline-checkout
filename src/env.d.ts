/** package.json version, set by vite.config.ts. */
declare const __APP_VERSION__: string;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

declare module "*.wasm?url" {
  const dataUrl: string;
  export default dataUrl;
}
