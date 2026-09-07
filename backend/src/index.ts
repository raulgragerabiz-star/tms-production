import { createApp } from "@/app";
import { env } from "@/config/env";

createApp().listen(env.port, () => {
  console.log(`Backend TMS escuchando en :${env.port}`);
});