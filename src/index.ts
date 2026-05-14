import app from './app';
import { env } from '@/config/env';
import { connectMongo } from '@/config/db';

connectMongo()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`[server] running in ${env.nodeEnv} mode on http://localhost:${env.port}`);
    });
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
