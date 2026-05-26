import app from './app';
import { env } from '@/config/env';
import { connectMongo } from '@/config/db';
import { ensureDemoData } from '@/services/bootstrapDemoData.service';
import { startScheduler } from '@/services/scheduler.service';
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
connectMongo()
  .then(async () => {
    await ensureDemoData();
    // Notification cron jobs (trip reminders, review prompts). Best-effort —
    // see scheduler.service.ts. Started after Mongo is up so the first cron
    // tick can rely on connected models.
    startScheduler();
    app.listen(env.port, () => {
      console.log(`[server] running in ${env.nodeEnv} mode on http://localhost:${env.port}`);
    });
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
