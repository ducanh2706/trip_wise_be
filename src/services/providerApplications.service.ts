import { Provider } from '@/models/Provider.model';
import { User, type UserDoc } from '@/models/User.model';
import { normalizeStoredRole } from '@/constants/authRoles';

export type ProviderApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProviderApplicationSummary {
  id: string;
  userId: string;
  applicantName: string;
  email: string | null;
  phone: string | null;
  image: string | null;
  role: string;
  status: ProviderApplicationStatus;
  specialty: string;
  yearsExperience: number | null;
  bio: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
}

export interface ProviderApplicationsResponse {
  status: ProviderApplicationStatus | 'ALL';
  counts: Record<ProviderApplicationStatus, number>;
  applications: ProviderApplicationSummary[];
}

export class ProviderApplicationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type LeanUser = Partial<UserDoc> & { _id: string };
type LeanProviderApplication = {
  _id: string;
  user_id?: string | null;
  business_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  specialty?: string | null;
  bio?: string | null;
  years_experience?: number | null;
  status?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
  updated_at?: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value: unknown): string | null {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function parseYearsExperience(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ProviderApplicationError(400, 'Years of experience must be a valid number');
  }
  return Math.round(parsed);
}

function normalizeStatus(value: unknown): ProviderApplicationStatus {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

function parseStatusFilter(value: unknown): ProviderApplicationStatus | 'ALL' {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  if (normalized === 'ALL') return 'ALL';
  return 'PENDING';
}

function displayName(user: LeanUser | undefined, application: LeanProviderApplication): string {
  return (
    application.contact_name?.trim() ||
    application.business_name?.trim() ||
    user?.full_name?.trim() ||
    user?.email?.trim() ||
    'Tripwise Traveler'
  );
}

function serializeApplication(
  application: LeanProviderApplication,
  user?: LeanUser,
): ProviderApplicationSummary {
  return {
    id: application._id,
    userId: application.user_id || application._id,
    applicantName: displayName(user, application),
    email: user?.email ?? null,
    phone: application.phone?.trim() || user?.phone || null,
    image: user?.image ?? null,
    role: normalizeStoredRole(user?.role),
    status: normalizeStatus(application.status),
    specialty: application.specialty?.trim() || 'Provider',
    yearsExperience:
      typeof application.years_experience === 'number' ? application.years_experience : null,
    bio: application.bio?.trim() || '',
    submittedAt: application.submitted_at ?? null,
    reviewedAt: application.reviewed_at ?? null,
    reviewedBy: application.reviewed_by ?? null,
    rejectionReason: application.rejection_reason ?? null,
  };
}

async function userMapForApplications(
  applications: LeanProviderApplication[],
): Promise<Map<string, LeanUser>> {
  const userIds = Array.from(new Set(applications.map((item) => item.user_id || item._id))).filter(
    (id) => id.trim().length > 0,
  );

  if (userIds.length === 0) return new Map();

  const users = (await User.find({ _id: { $in: userIds } })
    .select({
      _id: 1,
      full_name: 1,
      email: 1,
      phone: 1,
      image: 1,
      role: 1,
    })
    .lean()) as LeanUser[];

  return new Map(users.map((user) => [user._id, user] as const));
}

export async function submitProviderApplication(
  userId: string,
  body: unknown,
): Promise<ProviderApplicationSummary> {
  const input = (body ?? {}) as Record<string, unknown>;
  const fullName = normalizeText(input.fullName ?? input.name);
  const phone = normalizeOptionalText(input.phone);
  const specialty = normalizeText(input.specialty);
  const bio = normalizeText(input.bio);
  const yearsExperience = parseYearsExperience(input.yearsExperience);

  if (!fullName) {
    throw new ProviderApplicationError(400, 'Full name is required');
  }
  if (!phone) {
    throw new ProviderApplicationError(400, 'Phone number is required');
  }
  if (!specialty) {
    throw new ProviderApplicationError(400, 'Primary specialty is required');
  }
  if (bio.length < 20) {
    throw new ProviderApplicationError(400, 'Bio must be at least 20 characters');
  }

  const user = (await User.findById(userId).lean()) as LeanUser | null;
  if (!user) {
    throw new ProviderApplicationError(404, 'User not found');
  }

  if (normalizeStoredRole(user.role) === 'PROVIDER') {
    throw new ProviderApplicationError(409, 'This account already has provider access');
  }

  const now = new Date().toISOString();
  const application = (await Provider.findOneAndUpdate(
    { $or: [{ _id: userId }, { user_id: userId }] },
    {
      $set: {
        user_id: userId,
        business_name: fullName,
        contact_name: fullName,
        phone,
        specialty,
        bio,
        years_experience: yearsExperience,
        status: 'PENDING',
        submitted_at: now,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
        updated_at: now,
      },
      $setOnInsert: {
        _id: userId,
        created_at: now,
      },
    },
    { new: true, upsert: true },
  ).lean()) as LeanProviderApplication | null;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        full_name: fullName,
        phone,
        updated_at: now,
      },
    },
  );

  const updatedUser = {
    ...user,
    full_name: fullName,
    phone,
  };

  if (!application) {
    throw new ProviderApplicationError(500, 'Unable to submit application');
  }

  return serializeApplication(application, updatedUser);
}

export async function listProviderApplications(
  statusRaw: unknown,
): Promise<ProviderApplicationsResponse> {
  const status = parseStatusFilter(statusRaw);
  const filter =
    status === 'ALL' ? { status: { $in: ['PENDING', 'APPROVED', 'REJECTED'] } } : { status };

  const [applications, countsSource] = await Promise.all([
    Provider.find(filter).sort({ submitted_at: -1, updated_at: -1, _id: 1 }).lean(),
    Provider.find({ status: { $in: ['PENDING', 'APPROVED', 'REJECTED'] } })
      .select({ status: 1 })
      .lean(),
  ]);

  const counts: Record<ProviderApplicationStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
  };

  for (const item of countsSource as LeanProviderApplication[]) {
    counts[normalizeStatus(item.status)] += 1;
  }

  const typedApplications = applications as LeanProviderApplication[];
  const usersById = await userMapForApplications(typedApplications);

  return {
    status,
    counts,
    applications: typedApplications.map((application) =>
      serializeApplication(application, usersById.get(application.user_id || application._id)),
    ),
  };
}

export async function reviewProviderApplication(
  actorId: string,
  applicationUserId: string,
  body: unknown,
): Promise<ProviderApplicationSummary> {
  const input = (body ?? {}) as Record<string, unknown>;
  const decision = normalizeText(input.decision).toUpperCase();
  const isApproved = decision === 'APPROVED';
  const isRejected = decision === 'REJECTED';
  if (!isApproved && !isRejected) {
    throw new ProviderApplicationError(400, 'Decision must be APPROVED or REJECTED');
  }

  const application = (await Provider.findOne({
    $or: [{ _id: applicationUserId }, { user_id: applicationUserId }],
  }).lean()) as LeanProviderApplication | null;

  if (!application) {
    throw new ProviderApplicationError(404, 'Provider application not found');
  }

  const userId = application.user_id || application._id;
  const now = new Date().toISOString();
  const rejectionReason = isRejected
    ? (normalizeOptionalText(input.reason) ?? 'Rejected by admin')
    : null;

  const updated = (await Provider.findOneAndUpdate(
    { $or: [{ _id: userId }, { user_id: userId }] },
    {
      $set: {
        status: isApproved ? 'APPROVED' : 'REJECTED',
        reviewed_at: now,
        reviewed_by: actorId,
        rejection_reason: rejectionReason,
        updated_at: now,
      },
    },
    { new: true },
  ).lean()) as LeanProviderApplication | null;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        role: isApproved ? 'PROVIDER' : 'PLANNER',
        updated_at: now,
      },
    },
  );

  const user = (await User.findById(userId).lean()) as LeanUser | null;

  if (!updated) {
    throw new ProviderApplicationError(404, 'Provider application not found');
  }

  return serializeApplication(updated, user ?? undefined);
}
