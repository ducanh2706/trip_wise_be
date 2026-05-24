import { randomUUID } from 'crypto';
import { Booking } from '@/models/Booking.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { PayoutRequest, type PayoutRequestDoc } from '@/models/PayoutRequest.model';
import { Provider, type ProviderDoc } from '@/models/Provider.model';
import { User, type UserDoc } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { env } from '@/config/env';
import {
  PLATFORM_COMMISSION_RATE,
  calculateCommission,
  creditWallet,
  debitWallet,
  ensureWallet,
} from '@/services/walletLedger.service';

type PayoutPeriod = 'weekly' | 'monthly';
type PaidStatus = 'CONFIRMED' | 'PAID' | 'ACCEPTED' | 'APPROVED' | 'COMPLETED' | 'DONE';
type LeanProvider = Pick<ProviderDoc, '_id' | 'user_id' | 'business_name'>;
type LeanUser = Pick<UserDoc, '_id' | 'full_name' | 'email' | 'role'>;
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
  period: PayoutPeriod;
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

export interface AdminTestEscrowResponse {
  providerId: string;
  providerUserId: string;
  providerName: string;
  grossAmount: number;
  commissionAmount: number;
  providerNetAmount: number;
  bookingItemId: string;
}

export class AdminPayoutError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function normalizePeriod(value: unknown): PayoutPeriod {
  return typeof value === 'string' && value.trim().toLowerCase() === 'weekly'
    ? 'weekly'
    : 'monthly';
}

function periodRange(period: PayoutPeriod, anchor = new Date()) {
  if (period === 'weekly') {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const distanceFromMonday = (day + 6) % 7;
    start.setDate(start.getDate() - distanceFromMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { start, end };
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

async function eligibleItems(providerId: string | undefined, period: PayoutPeriod) {
  const { start, end } = periodRange(period);
  const baseFilter: Record<string, unknown> = {
    item_status: { $in: PAYABLE_STATUSES },
    escrow_status: 'HELD',
  };
  if (providerId) baseFilter.provider_id = providerId;

  const periodFilter: Record<string, unknown> = {
    ...baseFilter,
    created_at: {
      $gte: start.toISOString(),
      $lt: end.toISOString(),
    },
  };

  let items = (await BookingItem.find(periodFilter)
    .sort({ created_at: 1, _id: 1 })
    .lean()) as LeanPayoutItem[];

  if (items.length === 0) {
    items = (await BookingItem.find(baseFilter)
      .sort({ created_at: 1, _id: 1 })
      .lean()) as LeanPayoutItem[];
  }

  return { start, end, items };
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

async function ensureAdminEscrowBalance(requiredGrossAmount: number): Promise<void> {
  await ensureWallet(env.adminWalletUserId);
  const wallet = await Wallet.findOne({ user_id: env.adminWalletUserId }).lean();
  const currentBalance = wallet?.balance ?? 0;
  const required = Math.round(requiredGrossAmount);
  if (required <= currentBalance) return;

  await creditWallet({
    userId: env.adminWalletUserId,
    amount: required - currentBalance,
    type: 'ESCROW_RECONCILE_IN',
    status: 'SUCCESS',
    note: 'Reconciled admin wallet to cover held booking escrow',
  });
}

export async function listAdminProviderPayouts(
  periodRaw: unknown,
): Promise<AdminProviderPayoutsResponse> {
  const period = normalizePeriod(periodRaw);
  const { start, end, items } = await eligibleItems(undefined, period);
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

  await ensureAdminEscrowBalance(totals.grossAmount);
  const adminWallet = await Wallet.findOne({ user_id: env.adminWalletUserId }).lean();

  return {
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
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
  period?: unknown;
}): Promise<AdminProviderPayoutPaidResponse> {
  const period = normalizePeriod(input.period);
  const { start, end, items } = await eligibleItems(input.providerId, period);
  if (items.length === 0) {
    throw new AdminPayoutError(400, 'No held bookings found for this provider and period');
  }

  const providersById = await providersMap([input.providerId]);
  const provider = providersById.get(input.providerId);
  if (!provider) throw new AdminPayoutError(404, 'Provider not found');

  const summary = summarizeProvider(input.providerId, provider, items);
  if (summary.providerNetAmount <= 0) {
    throw new AdminPayoutError(400, 'Provider payout amount must be greater than zero');
  }

  await ensureAdminEscrowBalance(summary.grossAmount);
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
    period,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
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

  return {
    ...summary,
    payoutId: payout._id,
    paidAt,
  };
}

export async function createTestEscrowForProvider(input: {
  email: unknown;
  amount: unknown;
}): Promise<AdminTestEscrowResponse> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const amount = Math.round(Number(input.amount ?? 100));
  if (!email.includes('@')) throw new AdminPayoutError(400, 'Provider email is required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AdminPayoutError(400, 'Amount must be greater than zero');
  }

  const user = (await User.findOne({
    $or: [{ email_normalized: email }, { email }],
  }).lean()) as LeanUser | null;
  if (!user) throw new AdminPayoutError(404, `User not found for ${email}`);

  const userId = user._id;
  const providerName = user.full_name?.trim() || user.email || 'Tripwise Provider';
  const now = new Date().toISOString();
  const provider = await Provider.findOneAndUpdate(
    { $or: [{ _id: userId }, { user_id: userId }] },
    {
      $set: {
        user_id: userId,
        business_name: providerName,
        status: 'APPROVED',
        updated_at: now,
      },
      $setOnInsert: {
        _id: userId,
        created_at: now,
      },
    },
    { new: true, upsert: true },
  ).lean();

  await User.updateOne({ _id: userId }, { $set: { role: 'PROVIDER', updated_at: now } });
  await ensureWallet(userId);

  const providerId = provider?._id ?? userId;
  const settlement = calculateCommission(amount);
  const bookingId = randomUUID();
  const bookingItemId = randomUUID();

  await Booking.create({
    _id: bookingId,
    user_id: env.demoUserId,
    total_price: amount,
    total_amount: amount,
    discount_amount: 0,
    final_amount: amount,
    currency: 'USD',
    status: 'PENDING',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  await BookingItem.create({
    _id: bookingItemId,
    booking_id: bookingId,
    provider_id: providerId,
    room_id: null,
    flight_id: null,
    activity_id: null,
    start_date: now.slice(0, 10),
    end_date: now.slice(0, 10),
    quantity: 1,
    price_per_unit: amount,
    total_price: amount,
    gross_amount: settlement.grossAmount,
    commission_rate: PLATFORM_COMMISSION_RATE,
    commission_amount: settlement.commissionAmount,
    provider_net_amount: settlement.providerNetAmount,
    escrow_status: 'HELD',
    payout_request_id: null,
    paid_to_provider_at: null,
    item_status: 'PENDING',
    e_ticket_code: `TEST-${Date.now()}`,
    created_at: now,
    updated_at: now,
  });

  await creditWallet({
    userId: env.adminWalletUserId,
    amount,
    type: 'BOOKING_ESCROW_IN',
    status: 'HELD',
    bookingId,
    bookingItemId,
    providerId,
    note: `Test escrow for ${email}`,
  });

  return {
    providerId,
    providerUserId: userId,
    providerName,
    grossAmount: settlement.grossAmount,
    commissionAmount: settlement.commissionAmount,
    providerNetAmount: settlement.providerNetAmount,
    bookingItemId,
  };
}
