import { randomUUID } from 'crypto';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { PayoutRequest } from '@/models/PayoutRequest.model';
import { Provider, type ProviderDoc } from '@/models/Provider.model';
import { Wallet } from '@/models/Wallet.model';
import { env } from '@/config/env';
import {
  PLATFORM_COMMISSION_RATE,
  calculateCommission,
  creditWallet,
  debitWallet,
  ensureWallet,
} from '@/services/walletLedger.service';
import { createNotification } from '@/services/notifications.service';

type PaidStatus = 'CONFIRMED' | 'PAID' | 'ACCEPTED' | 'APPROVED' | 'COMPLETED' | 'DONE';
type LeanProvider = Pick<ProviderDoc, '_id' | 'user_id' | 'business_name'>;
type LeanPayoutItem = BookingItemDoc & {
  gross_amount?: number | null;
  commission_amount?: number | null;
  provider_net_amount?: number | null;
  escrow_status?: string | null;
};

const PAYABLE_STATUSES = [
  'PENDING',
  'REQUESTED',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'PAID',
  'ACCEPTED',
  'APPROVED',
  'COMPLETED',
  'DONE',
];

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

export interface AdminProviderPayoutPaidResponse extends AdminProviderPayoutSummary {
  payoutId: string;
  paidAt: string;
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

function amountParts(item: LeanPayoutItem) {
  const gross =
    typeof item.gross_amount === 'number' && Number.isFinite(item.gross_amount)
      ? item.gross_amount
      : (item.total_price ?? 0);
  const computed = calculateCommission(gross);
  return {
    grossAmount: computed.grossAmount,
    commissionAmount:
      typeof item.commission_amount === 'number' && Number.isFinite(item.commission_amount)
        ? item.commission_amount
        : computed.commissionAmount,
    providerNetAmount:
      typeof item.provider_net_amount === 'number' && Number.isFinite(item.provider_net_amount)
        ? item.provider_net_amount
        : computed.providerNetAmount,
  };
}

async function eligibleItems(providerId?: string) {
  const baseFilter: Record<string, unknown> = {
    item_status: { $in: PAYABLE_STATUSES },
    escrow_status: 'HELD',
  };
  if (providerId) baseFilter.provider_id = providerId;

  return (await BookingItem.find(baseFilter)
    .sort({ created_at: 1, _id: 1 })
    .lean()) as LeanPayoutItem[];
}

async function providersMap(providerIds: string[]): Promise<Map<string, LeanProvider>> {
  if (providerIds.length === 0) return new Map();
  const providers = (await Provider.find({ _id: { $in: providerIds } })
    .select({ _id: 1, user_id: 1, business_name: 1 })
    .lean()) as LeanProvider[];
  return new Map(providers.map((provider) => [provider._id, provider] as const));
}

function summarizeProvider(
  providerId: string,
  provider: LeanProvider | undefined,
  items: LeanPayoutItem[],
): AdminProviderPayoutSummary {
  const totals = items.reduce(
    (sum, item) => {
      const parts = amountParts(item);
      sum.grossAmount += parts.grossAmount;
      sum.commissionAmount += parts.commissionAmount;
      sum.providerNetAmount += parts.providerNetAmount;
      return sum;
    },
    { grossAmount: 0, commissionAmount: 0, providerNetAmount: 0 },
  );

  return {
    providerId,
    providerUserId: provider?.user_id || providerId,
    providerName: provider?.business_name ?? 'Tripwise Provider',
    bookingCount: items.length,
    ...totals,
    displayGrossAmount: formatCurrency(totals.grossAmount),
    displayCommissionAmount: formatCurrency(totals.commissionAmount),
    displayProviderNetAmount: formatCurrency(totals.providerNetAmount),
  };
}

export async function listAdminProviderPayouts(): Promise<AdminProviderPayoutsResponse> {
  const items = await eligibleItems();
  await ensureWallet(env.adminWalletUserId);

  const providerIds = Array.from(new Set(items.map((item) => item.provider_id)));
  const providersById = await providersMap(providerIds);
  const grouped = new Map<string, LeanPayoutItem[]>();
  for (const item of items) {
    const list = grouped.get(item.provider_id) ?? [];
    list.push(item);
    grouped.set(item.provider_id, list);
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

export async function payProviderForPeriod(input: {
  actorId: string;
  providerId: string;
}): Promise<AdminProviderPayoutPaidResponse> {
  const items = await eligibleItems(input.providerId);
  if (items.length === 0) {
    throw new AdminPayoutError(400, 'No held bookings found for this provider');
  }

  const providersById = await providersMap([input.providerId]);
  const provider = providersById.get(input.providerId);
  if (!provider) throw new AdminPayoutError(404, 'Provider not found');

  const summary = summarizeProvider(input.providerId, provider, items);
  if (summary.providerNetAmount <= 0) {
    throw new AdminPayoutError(400, 'Provider payout amount must be greater than zero');
  }

  const adminWallet = await Wallet.findOne({ user_id: env.adminWalletUserId }).lean();
  if ((adminWallet?.balance ?? 0) < summary.providerNetAmount) {
    throw new AdminPayoutError(400, 'Admin wallet does not have enough escrow balance');
  }

  const paidAt = new Date().toISOString();
  const payout = await PayoutRequest.create({
    _id: randomUUID(),
    provider_id: input.providerId,
    amount: summary.providerNetAmount,
    gross_amount: summary.grossAmount,
    commission_amount: summary.commissionAmount,
    commission_rate: PLATFORM_COMMISSION_RATE,
    currency: 'USD',
    status: 'PAID',
    requested_at: paidAt,
    scheduled_for: paidAt,
    paid_at: paidAt,
    paid_by: input.actorId,
    period: 'manual',
    period_start: null,
    period_end: null,
    booking_item_ids: items.map((item) => item._id),
    note: 'Admin released escrow payout to provider wallet',
  });

  await debitWallet({
    userId: env.adminWalletUserId,
    amount: summary.providerNetAmount,
    type: 'PROVIDER_PAYOUT_OUT',
    providerId: input.providerId,
    note: `Payout ${payout._id} to ${summary.providerName}`,
  });
  await creditWallet({
    userId: provider.user_id || provider._id,
    amount: summary.providerNetAmount,
    type: 'PROVIDER_PAYOUT',
    status: 'SUCCESS',
    providerId: input.providerId,
    note: `Provider payout ${payout._id}`,
  });

  await BookingItem.updateMany(
    { _id: { $in: items.map((item) => item._id) } },
    {
      $set: {
        escrow_status: 'PAID_OUT',
        payout_request_id: payout._id,
        paid_to_provider_at: paidAt,
        updated_at: paidAt,
      },
    },
  );

  // Idempotent on payoutId — a duplicate `payProvider` call (admin double-tap)
  // would have already errored on insufficient escrow, but defense in depth.
  const providerUserId = provider.user_id || provider._id;
  if (providerUserId) {
    await createNotification({
      id: `payout-${payout._id}`,
      userId: providerUserId,
      type: 'SYSTEM',
      title: 'Payout received',
      body: `${summary.displayProviderNetAmount} was credited to your wallet for ${summary.bookingCount} booking${summary.bookingCount === 1 ? '' : 's'}.`,
      actionRoute: '/provider_finance',
    });
  }

  return {
    ...summary,
    payoutId: payout._id,
    paidAt,
  };
}
