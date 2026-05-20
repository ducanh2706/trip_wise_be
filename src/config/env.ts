import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error('MONGO_URI is required but not set in environment');
}

const llmModel = process.env.LLM_MODEL ?? 'gemini-2.5-flash';
if (
  mongoUri.includes('<cluster>') ||
  mongoUri.includes('<user>') ||
  mongoUri.includes('<password>') ||
  /[<>]/.test(mongoUri)
) {
  throw new Error(
    'MONGO_URI still contains placeholders. Update trip_wise_be/.env with a real MongoDB URI.',
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  mongoUri,
  authSessionTtlDays: Math.max(1, Number(process.env.AUTH_SESSION_TTL_DAYS ?? 14) || 14),
  // No auth yet — wallet/loyalty is per-user, so the slice pins a demo user
  // (a real USER-role account that has a wallet + payments). Override via
  // DEMO_USER_ID in .env once login lands.
  demoUserId: process.env.DEMO_USER_ID ?? '337b6ec4-bd20-474c-9318-5898cfba516e',
  // Likewise, inventory/pricing is per-provider, so that slice pins a demo
  // provider (APPROVED, owns hotels with rooms). Override via DEMO_PROVIDER_ID.
  demoProviderId: process.env.DEMO_PROVIDER_ID ?? '51bbb04b-196e-4cb1-ba61-6fa4e42fdf68',
  // Path to a Firebase service-account JSON for FCM push. Absent by default —
  // push is best-effort and the server runs fine without it (see
  // src/config/firebase.ts). Override via FIREBASE_SERVICE_ACCOUNT in .env.
  firebaseServiceAccount:
    process.env.FIREBASE_SERVICE_ACCOUNT ??
    path.resolve(process.cwd(), 'secrets/firebase-service-account.json'),
  llmApiKey:
    process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  llmApiUrl:
    process.env.LLM_API_URL ??
    `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:generateContent`,
  llmModel,
};
