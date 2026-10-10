import { createApp, h } from "vue";
import "../../src/qr/zxing";
import QrScan from "../../src/qr/QrScan.vue";

createApp({
  render: () =>
    h(QrScan, {
      onDecoded: (text: string) => {
        document.getElementById("out")!.textContent = text;
      },
    }),
}).mount("#app");
