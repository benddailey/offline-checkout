import { createPinia } from "pinia";
import { createApp } from "vue";
import "./style.css";
import "./qr/zxing";
import App from "./App.vue";

createApp(App).use(createPinia()).mount("#app");
