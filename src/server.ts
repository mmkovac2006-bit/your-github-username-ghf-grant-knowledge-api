import { createApp } from "./app";
import { createConfig } from "./utils/config";

const config = createConfig();
const app = createApp({ config });

app.listen(config.port, () => {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "GHF Grant Knowledge API",
    event: "server_started",
    port: config.port
  }));
});
