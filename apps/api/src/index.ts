import { createApp } from "./app.js";
import { startDeliveryRetrySweep } from "./federation/deliveryQueue.js";
import { startExploreSweep } from "./federation/exploreSweep.js";
import { recordStartupAndDetectDowntime, startHeartbeat } from "./heartbeat.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

recordStartupAndDetectDowntime()
  .catch((err) => logger.warn({ err }, "startup downtime detection failed"))
  .finally(() => {
    app.listen(port, () => {
      logger.info(`gibrr api listening on :${port}`);
      startDeliveryRetrySweep();
      startExploreSweep();
      startHeartbeat();
    });
  });
