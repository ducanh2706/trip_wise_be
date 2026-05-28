import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error('MONGO_URI is required but not set in environment');
}

const llmModel = process.env.LLM_MODEL ?? 'gemini-2.5-flash';
const defaultFirebaseServiceAccount = path.resolve(
  process.cwd(),
  'secrets/firebase-service-account.json',
);
const firebaseServiceAccount =
  process.env.FIREBASE_SERVICE_ACCOUNT ?? defaultFirebaseServiceAccount;

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function discoverFirebaseProjectId(): string {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    '';
  if (fromEnv.trim()) return fromEnv.trim();

  const serviceAccount = readJsonFile(firebaseServiceAccount);
  const serviceProjectId = serviceAccount?.project_id;
  if (typeof serviceProjectId === 'string' && serviceProjectId.trim()) {
    return serviceProjectId.trim();
  }

  const googleServicesCandidates = [
    path.resolve(process.cwd(), '../trip_wise/android/app/google-services.json'),
    path.resolve(process.cwd(), 'android/app/google-services.json'),
  ];
  for (const candidate of googleServicesCandidates) {
    const googleServices = readJsonFile(candidate);
    const projectInfo = googleServices?.project_info;
    if (projectInfo && typeof projectInfo === 'object') {
      const projectId = (projectInfo as Record<string, unknown>).project_id;
      if (typeof projectId === 'string' && projectId.trim()) {
        return projectId.trim();
      }
    }
  }

  return '';
}

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
  adminWalletUserId: process.env.ADMIN_WALLET_USER_ID ?? 'tripwise-admin-wallet',
  platformCommissionRate: Math.min(
    Math.max(Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.08) || 0.08, 0),
    0.5,
  ),
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
  firebaseServiceAccount,
  firebaseProjectId: discoverFirebaseProjectId(),
  llmApiKey:
    process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  llmApiUrl:
    process.env.LLM_API_URL ??
    `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:generateContent`,
  llmModel,
  payosClientId: process.env.PAYOS_CLIENT_ID?.trim() ?? '',
  payosApiKey: process.env.PAYOS_API_KEY?.trim() ?? '',
  payosChecksumKey: process.env.PAYOS_CHECKSUM_KEY?.trim() ?? '',
  payosReturnUrl: process.env.PAYOS_RETURN_URL?.trim() ?? 'tripwise://payos/return',
  payosCancelUrl: process.env.PAYOS_CANCEL_URL?.trim() ?? 'tripwise://payos/cancel',
  payosQrExpireSeconds: Math.max(60, Number(process.env.PAYOS_QR_EXPIRE_SECONDS ?? 300) || 300),
  redisUrl: process.env.REDIS_URL?.trim() ?? '',
  redisHotelDetailTtlSeconds: Math.max(
    30,
    Number(process.env.REDIS_HOTEL_DETAIL_TTL_SECONDS ?? 300) || 300,
  ),
};
