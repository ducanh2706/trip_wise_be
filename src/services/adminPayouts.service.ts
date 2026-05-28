import { PayoutRequest, type PayoutRequestDoc } from '@/models/PayoutRequest.model';
import { Provider, type ProviderDoc } from '@/models/Provider.model';
import { Wallet } from '@/models/Wallet.model';
import { env } from '@/config/env';
import {
  PLATFORM_COMMISSION_RATE,
  ensureWallet,
} from '@/services/walletLedger.service';
import { createNotification } from '@/services/notifications.service';

type LeanProvider = Pick<ProviderDoc, '_id' | 'user_id' | 'business_name'>;
type LeanPayoutRequest = PayoutRequestDoc;

const PAYABLE_REQUEST_STATUSES = ['PENDING', 'SCHEDULED', 'REQUESTED', 'AWAITING_APPROVAL'];
type PayoutReviewDecision = 'APPROVED' | 'REJECTED';

export interface AdminProviderPayoutSummary {
  providerId: string;
  providerUserId: string;
  providerName: string;
  bookingCount: number;
  grossAmount: number;
  commissionAmount: number;
  providerNetAmount: number;
  displayGrossAmount: string;
  displayCommissionAmount: string;
  displayProviderNetAmount: string;
  payoutRequestIds: string[];
  requestedAt: string | null;
}

export interface AdminProviderPayoutsResponse {
  period: 'manual';
  periodStart: string;
  periodEnd: string;
  commissionRate: number;
  commissionLabel: string;
  adminWallet: {
    userId: string;
    balance: number;
    displayBalance: string;
  };
  totals: {
    bookingCount: number;
    grossAmount: number;
    commissionAmount: number;
    providerNetAmount: number;
    displayGrossAmount: string;
    displayCommissionAmount: string;
    displayProviderNetAmount: string;
  };
  providers: AdminProviderPayoutSummary[];
}

export interface AdminProviderPayoutReviewResponse extends AdminProviderPayoutSummary {
  decision: PayoutReviewDecision;
  reviewedAt: string;
}

export class AdminPayoutError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Math.round(value));
}

async function payableRequests(providerId?: string): Promise<LeanPayoutRequest[]> {
  const filter: Record<string, unknown> = {
    status: { $in: PAYABLE_REQUEST_STATUSES },
  };
  if (providerId) filter.provider_id = providerId;

  return (await PayoutRequest.find(filter)
    .sort({ requested_at: 1, _id: 1 })
    .lean()) as LeanPayoutRequest[];
}

async function providersMap(providerIds: string[]): Promise<Map<string, LeanProvider>> {
  if (providerIds.length === 0) return new Map();
  const providers = (await Provider.find({ _id: { $in: providerIds } })
    .select({ _id: 1, user_id: 1, business_name: 1 })
    .lean()) as LeanProvider[];
  return new Map(providers.map((provider) => [provider._id, provider] as const));
}

function requestAmount(request: LeanPayoutRequest): number {
  return typeof request.amount === 'number' && Number.isFinite(request.amount) ? request.amount : 0;
}

function requestGrossAmount(request: LeanPayoutRequest): number {
  return typeof request.gross_amount === 'number' && Number.isFinite(request.gross_amount)
    ? request.gross_amount
    : requestAmount(request);
}

function requestCommissionAmount(request: LeanPayoutRequest): number {
  return typeof request.commission_amount === 'number' && Number.isFinite(request.commission_amount)
    ? request.commission_amount
    : 0;
}

function summarizeProvider(
  providerId: string,
  provider: LeanProvider | undefined,
  requests: LeanPayoutRequest[],
): AdminProviderPayoutSummary {
  const totals = requests.reduce(
    (sum, request) => {
      sum.grossAmount += requestGrossAmount(request);
      sum.commissionAmount += requestCommissionAmount(request);
      sum.providerNetAmount += requestAmount(request);
      return sum;
    },
    { grossAmount: 0, commissionAmount: 0, providerNetAmount: 0 },
  );
  const requestedAt =
    requests
      .map((request) => request.requested_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort()[0] ?? null;

  return {
    providerId,
    providerUserId: provider?.user_id || providerId,
    providerName: provider?.business_name ?? 'Tripwise Provider',
    bookingCount: requests.length,
    ...totals,
    displayGrossAmount: formatCurrency(totals.grossAmount),
    displayCommissionAmount: formatCurrency(totals.commissionAmount),
    displayProviderNetAmount: formatCurrency(totals.providerNetAmount),
    payoutRequestIds: requests.map((request) => request._id),
    requestedAt,
  };
}

export async function listAdminProviderPayouts(): Promise<AdminProviderPayoutsResponse> {
  const requests = await payableRequests();
  await ensureWallet(env.adminWalletUserId);

  const providerIds = Array.from(new Set(requests.map((request) => request.provider_id)));
  const providersById = await providersMap(providerIds);
  const grouped = new Map<string, LeanPayoutRequest[]>();
  for (const request of requests) {
    const list = grouped.get(request.provider_id) ?? [];
    list.push(request);
    grouped.set(request.provider_id, list);
  }

  const providers = Array.from(grouped.entries())
    .map(([providerId, rows]) => summarizeProvider(providerId, providersById.get(providerId), rows))
    .sort((left, right) => right.providerNetAmount - left.providerNetAmount);

  const totals = providers.reduce(
    (sum, provider) => {
      sum.bookingCount += provider.bookingCount;
      sum.grossAmount += provider.grossAmount;
      sum.commissionAmount += provider.commissionAmount;
      sum.providerNetAmount += provider.providerNetAmount;
      return sum;
    },
    { bookingCount: 0, grossAmount: 0, commissionAmount: 0, providerNetAmount: 0 },
  );

  const adminWallet = await Wallet.findOne({ user_id: env.adminWalletUserId }).lean();

  return {
    period: 'manual',
    periodStart: '',
    periodEnd: '',
    commissionRate: PLATFORM_COMMISSION_RATE,
    commissionLabel: `${Math.round(PLATFORM_COMMISSION_RATE * 100)}%`,
    adminWallet: {
      userId: env.adminWalletUserId,
      balance: adminWallet?.balance ?? 0,
      displayBalance: formatCurrency(adminWallet?.balance ?? 0),
    },
    totals: {
      ...totals,
      displayGrossAmount: formatCurrency(totals.grossAmount),
      displayCommissionAmount: formatCurrency(totals.commissionAmount),
      displayProviderNetAmount: formatCurrency(totals.providerNetAmount),
    },
    providers,
  };
}

function normalizeDecision(value: unknown): PayoutReviewDecision {
  if (typeof value !== 'string') {
    throw new AdminPayoutError(400, 'Payout decision is required');
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'APPROVE' || normalized === 'APPROVED' || normalized === 'ACCEPT') {
    return 'APPROVED';
  }
  if (normalized === 'REJECT' || normalized === 'REJECTED' || normalized === 'DECLINE') {
    return 'REJECTED';
  }
  throw new AdminPayoutError(400, 'Payout decision must be APPROVED or REJECTED');
}

export async function reviewProviderPayoutRequests(input: {
  actorId: string;
  providerId: string;
  decision: unknown;
}): Promise<AdminProviderPayoutReviewResponse> {
  const decision = normalizeDecision(input.decision);
  const requests = await payableRequests(input.providerId);
  if (requests.length === 0) {
    throw new AdminPayoutError(400, 'No pending payout requests found for this provider');
  }

  const providersById = await providersMap([input.providerId]);
  const provider = providersById.get(input.providerId);
  if (!provider) throw new AdminPayoutError(404, 'Provider not found');

  const summary = summarizeProvider(input.providerId, provider, requests);
  if (summary.providerNetAmount <= 0) {
    throw new AdminPayoutError(400, 'Provider payout amount must be greater than zero');
  }

  const providerUserId = provider.user_id || provider._id;
  const reviewedAt = new Date().toISOString();

  await PayoutRequest.updateMany(
    { _id: { $in: summary.payoutRequestIds } },
    {
      $set: {
        status: decision,
        reviewed_by: input.actorId,
        reviewed_at: reviewedAt,
        note:
          decision === 'APPROVED'
            ? 'Admin accepted payout request'
            : 'Admin rejected payout request',
      },
    },
  );

  await createNotification({
    id: `payout-review-${decision.toLowerCase()}-${summary.payoutRequestIds.join('-')}`,
    userId: providerUserId,
    type: 'SYSTEM',
    title: decision === 'APPROVED' ? 'Payout request accepted' : 'Payout request rejected',
    body:
      decision === 'APPROVED'
        ? `${summary.displayProviderNetAmount} payout request was accepted.`
        : `${summary.displayProviderNetAmount} payout request was rejected and is available to request again.`,
    actionRoute: '/provider_finance',
  });

  return {
    ...summary,
    decision,
    reviewedAt,
  };
}
