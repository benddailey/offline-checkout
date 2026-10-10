declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

declare module "*.wasm?url" {
  const dataUrl: string;
  export default dataUrl;
}
