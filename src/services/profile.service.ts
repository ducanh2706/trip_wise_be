import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProfileVerification } from '@/models/ProfileVerification.model';
import { Provider } from '@/models/Provider.model';
import { Trip } from '@/models/Trip.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { normalizeStoredRole } from '@/constants/authRoles';

export interface ProfileResponse {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    image: string | null;
    tierLabel: string;
    countriesVisited: number;
  };
  provider: {
    isRegistered: boolean;
    ctaLabel: string;
    ctaRoute: string;
    dashboardRoute: string;
  };
  verification: {
    passportUploaded: boolean;
    passportNote: string;
    passportImageUrl: string | null;
    addressUploaded: boolean;
    addressNote: string;
    addressImageUrl: string | null;
    updatedAt: string | null;
  };
}

export interface UpdateAvatarResponse {
  imageUrl: string;
}

export interface UpdateVerificationDocumentResponse {
  verification: ProfileResponse['verification'];
}

export class ProfileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const AVATAR_DIR = path.resolve(process.cwd(), 'uploads/avatars');
const VERIFICATION_DIR = path.resolve(process.cwd(), 'uploads/verifications');
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const MAX_VERIFICATION_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VERIFICATION_DOCUMENTS = {
  passport: {
    uploadedField: 'passport_uploaded',
    noteField: 'passport_note',
    imageField: 'passport_image_url',
    submittedNote: 'Submitted for review',
  },
  address: {
    uploadedField: 'address_uploaded',
    noteField: 'address_note',
    imageField: 'address_image_url',
    submittedNote: 'Submitted for review',
  },
} as const;

type VerificationDocumentType = keyof typeof VERIFICATION_DOCUMENTS;

type ProfileVerificationLike = {
  passport_uploaded?: boolean | null;
  passport_note?: string | null;
  passport_image_url?: string | null;
  address_uploaded?: boolean | null;
  address_note?: string | null;
  address_image_url?: string | null;
  updated_at?: string | null;
};

function deriveTier(points: number): string {
  if (points >= 15000) return 'Platinum Voyager';
  if (points >= 5000) return 'Gold Voyager';
  return 'Premium Voyager';
}

async function ensureVerification(userId: string): Promise<void> {
  const existing = await ProfileVerification.findById(userId).lean();
  if (existing) return;
  await ProfileVerification.create({
    _id: userId,
    passport_uploaded: false,
    passport_note: 'Not submitted',
    passport_image_url: null,
    address_uploaded: false,
    address_note: 'Not submitted',
    address_image_url: null,
    updated_at: new Date().toISOString(),
  });
}

function destinationKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

function serializeVerification(
  verification: ProfileVerificationLike | null | undefined,
): ProfileResponse['verification'] {
  return {
    passportUploaded: verification?.passport_uploaded ?? false,
    passportNote: verification?.passport_note ?? 'Not submitted',
    passportImageUrl: verification?.passport_image_url ?? null,
    addressUploaded: verification?.address_uploaded ?? false,
    addressNote: verification?.address_note ?? 'Not submitted',
    addressImageUrl: verification?.address_image_url ?? null,
    updatedAt: verification?.updated_at ?? null,
  };
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  await ensureVerification(userId);

  const [user, wallet, trips, verification, provider] = await Promise.all([
    User.findById(userId).lean(),
    Wallet.findOne({ user_id: userId }).lean(),
    Trip.find({ user_id: userId }).select({ destination: 1 }).lean(),
    ProfileVerification.findById(userId).lean(),
    Provider.findOne({ $or: [{ user_id: userId }, { _id: userId }] }).lean(),
  ]);

  const visited = new Set<string>();
  for (const trip of trips) {
    const key = destinationKey(trip.destination);
    if (key) visited.add(key);
  }

  const points = wallet?.loyalty_points ?? 0;
  const displayName = user?.full_name?.trim() || 'Tripwise Traveler';
  const providerStatus = provider?.status?.trim().toUpperCase() ?? null;
  const hasProviderAccess =
    normalizeStoredRole(user?.role) === 'PROVIDER' && providerStatus !== 'INACTIVE';
  const providerCtaLabel = hasProviderAccess
    ? 'Open Provider Dashboard'
    : providerStatus === 'PENDING'
      ? 'Application Pending'
      : providerStatus === 'REJECTED'
        ? 'Resubmit Registration'
        : 'Start Registration';

  return {
    user: {
      id: userId,
      name: displayName,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      image: user?.image ?? null,
      tierLabel: deriveTier(points),
      countriesVisited: Math.max(visited.size, 1),
    },
    provider: {
      isRegistered: hasProviderAccess,
      ctaLabel: providerCtaLabel,
      ctaRoute: hasProviderAccess ? '/provider_dashboard' : '/provider_registration_form',
      dashboardRoute: '/provider_dashboard',
    },
    verification: serializeVerification(verification),
  };
}

function normalizeMimeType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== 'string') return 'avatar';
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized.length > 0 ? normalized : 'avatar';
}

function normalizeBase64(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx > 0 && trimmed.slice(0, commaIdx).includes('base64')) {
    return trimmed.slice(commaIdx + 1).trim();
  }
  return trimmed;
}

function readImageUpload(
  input: Record<string, unknown>,
  maxBytes: number,
  label: string,
): { buffer: Buffer; ext: string; mimeType: string; originalName: string } {
  const mimeType = normalizeMimeType(input.mimeType);
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) {
    throw new ProfileError(400, 'Only JPG, PNG, WEBP images are supported');
  }

  const base64Data = normalizeBase64(input.dataBase64);
  if (!base64Data) {
    throw new ProfileError(400, `${label} data is required`);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    throw new ProfileError(400, `Invalid ${label.toLowerCase()} data`);
  }

  if (!buffer.length) {
    throw new ProfileError(400, `${label} data is empty`);
  }
  if (buffer.length > maxBytes) {
    const limitMb = Math.round(maxBytes / 1024 / 1024);
    throw new ProfileError(413, `${label} exceeds ${limitMb}MB limit`);
  }

  return {
    buffer,
    ext,
    mimeType,
    originalName: normalizeFileName(input.fileName),
  };
}

function normalizeVerificationDocumentType(value: unknown): VerificationDocumentType {
  if (value === 'passport' || value === 'address') {
    return value;
  }
  throw new ProfileError(400, 'Unsupported verification document type');
}

export async function updateProfileAvatar(
  userId: string,
  body: unknown,
  publicBaseUrl: string,
): Promise<UpdateAvatarResponse> {
  const input = (body ?? {}) as Record<string, unknown>;
  const upload = readImageUpload(input, MAX_AVATAR_BYTES, 'Avatar');
  const imageUrl = `data:${upload.mimeType};base64,${upload.buffer.toString('base64')}`;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        image: imageUrl,
        updated_at: new Date().toISOString(),
      },
    },
  );

  return { imageUrl };
}

export async function updateProfileVerificationDocument(
  userId: string,
  rawDocumentType: unknown,
  body: unknown,
  publicBaseUrl: string,
): Promise<UpdateVerificationDocumentResponse> {
  const documentType = normalizeVerificationDocumentType(rawDocumentType);
  const config = VERIFICATION_DOCUMENTS[documentType];
  const input = (body ?? {}) as Record<string, unknown>;
  const upload = readImageUpload(input, MAX_VERIFICATION_BYTES, 'Verification document');

  const now = Date.now();
  const fileName = `${userId}-${documentType}-${now}-${upload.originalName}.${upload.ext}`;
  const diskDir = path.join(VERIFICATION_DIR, documentType);
  const diskPath = path.join(diskDir, fileName);
  const imagePath = `/uploads/verifications/${documentType}/${fileName}`;

  await mkdir(diskDir, { recursive: true });
  await writeFile(diskPath, upload.buffer);

  const imageUrl = `${publicBaseUrl}${imagePath}`;
  const updatedAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    [config.uploadedField]: true,
    [config.noteField]: config.submittedNote,
    [config.imageField]: imageUrl,
    updated_at: updatedAt,
  };

  const verification = await ProfileVerification.findByIdAndUpdate(
    userId,
    {
      $set: updates,
      $setOnInsert: { _id: userId },
    },
    { new: true, upsert: true },
  ).lean();

  return { verification: serializeVerification(verification) };
}

export async function deleteProfileVerificationDocument(
  userId: string,
  rawDocumentType: unknown,
): Promise<UpdateVerificationDocumentResponse> {
  const documentType = normalizeVerificationDocumentType(rawDocumentType);
  const config = VERIFICATION_DOCUMENTS[documentType];
  const updatedAt = new Date().toISOString();
  const resetNote = 'Not submitted';
  const updates: Record<string, unknown> = {
    [config.uploadedField]: false,
    [config.noteField]: resetNote,
    [config.imageField]: null,
    updated_at: updatedAt,
  };

  const verification = await ProfileVerification.findByIdAndUpdate(
    userId,
    {
      $set: updates,
      $setOnInsert: { _id: userId },
    },
    { new: true, upsert: true },
  ).lean();

  return { verification: serializeVerification(verification) };
}
