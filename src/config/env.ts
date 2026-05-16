import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error('MONGO_URI is required but not set in environment');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  mongoUri,
  // No auth yet — wallet/loyalty is per-user, so the slice pins a demo user
  // (a real USER-role account that has a wallet + payments). Override via
  // DEMO_USER_ID in .env once login lands.
  demoUserId:
    process.env.DEMO_USER_ID ?? '337b6ec4-bd20-474c-9318-5898cfba516e',
};
