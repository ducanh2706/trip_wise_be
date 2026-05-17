import app from './app';
import { env } from '@/config/env';
import { connectMongo } from '@/config/db';
import { ensureDemoData } from '@/services/bootstrapDemoData.service';
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
connectMongo()
  .then(async () => {
    await ensureDemoData();
    app.listen(env.port, () => {
      console.log(`[server] running in ${env.nodeEnv} mode on http://localhost:${env.port}`);
    });
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
