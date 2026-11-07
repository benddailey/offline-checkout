import { createPinia } from "pinia";
import { createApp } from "vue";
import "./style.css";
import "./qr/zxing";
import App from "./App.vue";
import { downloadMissingPhotos, loadSavedPhotos } from "./ui/backgrounds/saved";
import { applySavedTheme } from "./ui/theme";

applySavedTheme();
createApp(App).use(createPinia()).mount("#app");

// Sessions live only in this browser, so ask Chrome not to clear them under disk pressure. It may
// say no (it decides by itself); the photos sit in their own bucket that is never persisted.
void navigator.storage?.persist?.().catch(() => {});
void loadSavedPhotos()
  .catch(() => {})
  .then(downloadMissingPhotos);
