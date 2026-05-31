import { randomUUID } from 'crypto';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Wallet } from '@/models/Wallet.model';
import { Payment } from '@/models/Payment.model';
import { User } from '@/models/User.model';
import { Card } from '@/models/Card.model';
import { WalletTx } from '@/models/WalletTransaction.model';
import { createNotification } from '@/services/notifications.service';

const COMPLETED_POINT_RATE = 0.01;
const COMPLETED_ITEM_STATUSES = ['COMPLETED', 'DONE'];

// Every mock card is minted with this USD balance for demo top-up/withdraw.
const CARD_SEED_BALANCE = 1_200;

// Max rows in the wallet screen's "Recent Transactions" preview. The full
// history is reachable via "See all" (GET /wallet/transactions, paginated).
const RECENT_TX_PREVIEW = 5;

export interface WalletTransaction {
  id: string;
  title: string;
  subtitle: string;
  method: string;
  amountVnd: number;
  status: string;
}

export interface WalletCard {
  id: string;
  brand: string;
  last4: string;
  holderName: string | null;
  balance: number;
  isDefault: boolean;
}

export interface WalletOverviewResponse {
  user: { id: string; name: string; image: string | null } | null;
  balance: number;
  currency: string;
  loyaltyPoints: number;
  completedInvoiceVnd: number;
  pointsRate: number;
  pointsRateLabel: string;
  pointsValueVnd: number;
  tier: {
    current: string;
    next: string | null;
    pointsToNext: number | null;
    progress: number;
  };
  cards: WalletCard[];
  transactions: WalletTransaction[];
}

export interface TransactionPage {
  items: WalletTransaction[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function titleForMethod(method?: string | null): string {
  switch (method) {
    case 'VNPAY':
      return 'VNPAY payment';
    case 'MOMO':
      return 'MoMo payment';
    case 'CREDIT_CARD':
      return 'Card payment';
    case 'WALLET':
      return 'Wallet payment';
    case 'PAYLATER':
      return 'Pay Later';
    default:
      return 'Payment';
  }
}

function mapCard(c: {
  _id: string;
  brand: string;
  last4: string;
  holder_name?: string | null;
  balance: number;
  is_default?: boolean;
}): WalletCard {
  return {
    id: c._id,
    brand: c.brand,
    last4: c.last4,
    holderName: c.holder_name ?? null,
    balance: c.balance ?? 0,
    isDefault: c.is_default ?? false,
  };
}

/** A thrown error the controller maps to a 4xx instead of a 500. */
export class WalletError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Idempotently make sure the demo user owns at least one (default) card. */
async function ensureDefaultCard(userId: string, userName?: string | null): Promise<void> {
  const count = await Card.countDocuments({ user_id: userId });
  if (count > 0) return;
  const now = new Date().toISOString();
  await Card.create({
    _id: randomUUID(),
    user_id: userId,
    brand: 'VISA',
    last4: '4242',
    holder_name: userName ?? 'Tripwise Member',
    balance: CARD_SEED_BALANCE,
    is_default: true,
    created_at: now,
    updated_at: now,
  });
}

/** Merge seeded booking payments + mock wallet ledger into one feed. */
async function buildLedger(userId: string): Promise<WalletTransaction[]> {
  const [payments, walletTxs] = await Promise.all([
    Payment.find({ user_id: userId }).lean(),
    WalletTx.find({ user_id: userId }).lean(),
  ]);

  const fromPayments: Array<WalletTransaction & { _ts: number }> = payments.map((p) => {
    const ref = p.booking_id ? `Booking ${p.booking_id}` : 'Payment';
    const date = formatDate(p.created_at);
    return {
      id: p._id,
      title: titleForMethod(p.payment_method),
      subtitle: date ? `${ref} • ${date}` : ref,
      method: p.payment_method ?? 'UNKNOWN',
      amountVnd: -(p.amount ?? 0),
      status: p.status ?? 'UNKNOWN',
      _ts: new Date(p.created_at ?? 0).getTime() || 0,
    };
  });

  const fromWallet: Array<WalletTransaction & { _ts: number }> = walletTxs.map((t) => {
    const isTopup = t.type === 'TOPUP';
    const isVipUpgrade = t.type === 'VIP_UPGRADE';
    const isProviderPayout = t.type === 'PROVIDER_PAYOUT';
    const isEscrowIn = t.type === 'BOOKING_ESCROW_IN';
    const isPayoutOut = t.type === 'PROVIDER_PAYOUT_OUT';
    const isRefundIn = t.type === 'BOOKING_REFUND_IN';
    const isRefundOut = t.type === 'BOOKING_REFUND_OUT';
    const isPointRedeem = t.type === 'POINT_REDEEM';
    const date = formatDate(t.created_at);
    const isPositive = isTopup || isProviderPayout || isEscrowIn || isRefundIn;
    const cardLabel = t.card_last4 ? `card •• ${t.card_last4}` : 'card';
    return {
      id: t._id,
      title: isTopup
        ? 'Wallet top-up'
        : isProviderPayout
          ? 'Provider payout'
          : isEscrowIn
            ? 'Booking escrow received'
            : isPayoutOut
              ? 'Provider payout released'
              : isRefundIn
                ? 'Booking refund'
                : isRefundOut
                  ? 'Booking refund paid'
                  : isPointRedeem
                    ? 'Points used'
                    : isVipUpgrade
                      ? 'VIP plan upgrade'
                      : 'Withdrawal',
      subtitle:
        (isTopup
          ? `From ${cardLabel}`
          : isRefundIn
            ? 'Refund to wallet'
            : isRefundOut
              ? 'Refund from held wallet'
              : isPointRedeem
                ? 'Booking discount'
                : isVipUpgrade
                  ? 'Elite Provider plan'
                  : `To ${cardLabel}`) +
        (date ? ` • ${date}` : ''),
      method: t.type,
      amountVnd: isPositive ? Math.abs(t.amount) : -Math.abs(t.amount),
      status: t.status ?? 'SUCCESS',
      _ts: new Date(t.created_at ?? 0).getTime() || 0,
    };
  });

  return [...fromPayments, ...fromWallet]
    .sort((a, b) => b._ts - a._ts)
    .map(({ _ts, ...rest }) => rest);
}

export async function calculateCompletedPoints(userId: string): Promise<{
  completedInvoiceVnd: number;
  earnedPoints: number;
  redeemedPoints: number;
  points: number;
}> {
  const bookings = await Booking.find({ user_id: userId }).select({ _id: 1 }).lean();
  const bookingIds = bookings.map((booking) => String(booking._id));
  if (bookingIds.length === 0) {
    const redeemedOnly = await redeemedPointsForUser(userId);
    return {
      completedInvoiceVnd: 0,
      earnedPoints: 0,
      redeemedPoints: redeemedOnly,
      points: 0,
    };
  }

  const [items, redeemedPoints] = await Promise.all([
    BookingItem.find({
      booking_id: { $in: bookingIds },
      item_status: { $in: COMPLETED_ITEM_STATUSES },
    })
      .select({ total_price: 1, gross_amount: 1 })
      .lean(),
    redeemedPointsForUser(userId),
  ]);

  const completedInvoiceVnd = items.reduce((sum, item) => {
    const amount =
      typeof item.total_price === 'number' && Number.isFinite(item.total_price)
        ? item.total_price
        : typeof item.gross_amount === 'number' && Number.isFinite(item.gross_amount)
          ? item.gross_amount
          : 0;
    return sum + Math.max(0, amount);
  }, 0);

  const earnedPoints = Math.round(completedInvoiceVnd * COMPLETED_POINT_RATE);

  return {
    completedInvoiceVnd: Math.round(completedInvoiceVnd),
    earnedPoints,
    redeemedPoints,
    points: Math.max(earnedPoints - redeemedPoints, 0),
  };
}

async function redeemedPointsForUser(userId: string): Promise<number> {
  const rows = await WalletTx.find({
    user_id: userId,
    type: 'POINT_REDEEM',
    status: 'SUCCESS',
  })
    .select({ amount: 1 })
    .lean();
  return Math.round(
    rows.reduce((sum, row) => sum + Math.max(0, row.amount ?? 0), 0),
  );
}

export async function syncUserLoyaltyPoints(userId: string): Promise<number> {
  const summary = await calculateCompletedPoints(userId);
  await Wallet.updateOne(
    { user_id: userId },
    {
      $set: {
        loyalty_points: summary.points,
        updated_at: new Date().toISOString(),
      },
    },
    { upsert: false },
  );
  return summary.points;
}

export async function getWalletOverview(userId: string): Promise<WalletOverviewResponse | null> {
  const wallet = await Wallet.findOne({ user_id: userId }).lean();
  if (!wallet) return null;

  const user = await User.findById(userId).lean();
  await ensureDefaultCard(userId, user?.full_name);

  const [cards, ledger, pointSummary] = await Promise.all([
    Card.find({ user_id: userId }).sort({ is_default: -1, created_at: 1 }).lean(),
    buildLedger(userId),
    calculateCompletedPoints(userId),
  ]);

  const points = pointSummary.points;
  if ((wallet.loyalty_points ?? 0) !== points) {
    await syncUserLoyaltyPoints(userId);
  }

  return {
    user: user
      ? { id: user._id, name: user.full_name ?? 'Traveler', image: user.image ?? null }
      : null,
    balance: wallet.balance ?? 0,
    currency: 'USD',
    loyaltyPoints: points,
    completedInvoiceVnd: pointSummary.completedInvoiceVnd,
    pointsRate: COMPLETED_POINT_RATE,
    pointsRateLabel: '1%',
    pointsValueVnd: 0,
    tier: { current: 'POINTS', next: null, pointsToNext: null, progress: 0 },
    cards: cards.map(mapCard),
    transactions: ledger.slice(0, RECENT_TX_PREVIEW),
  };
}

export async function getTransactionsPage(
  userId: string,
  offset: number,
  limit: number,
): Promise<TransactionPage> {
  const ledger = await buildLedger(userId);
  const items = ledger.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: ledger.length,
    hasMore: nextOffset < ledger.length,
    nextOffset,
  };
}

async function resolveCard(userId: string, cardId?: string) {
  const card = cardId
    ? await Card.findOne({ _id: cardId, user_id: userId })
    : await Card.findOne({ user_id: userId }).sort({ is_default: -1, created_at: 1 });
  if (!card) throw new WalletError(404, 'No payment card found');
  return card;
}

function assertAmount(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new WalletError(400, 'Amount must be a positive number');
  }
  return Math.round(n);
}

export async function topUp(
  userId: string,
  amountInput: unknown,
  cardId?: string,
): Promise<WalletOverviewResponse> {
  const wallet = await Wallet.findOne({ user_id: userId });
  if (!wallet) throw new WalletError(404, 'Wallet not found');
  const user = await User.findById(userId).lean();
  await ensureDefaultCard(userId, user?.full_name);

  const amount = assertAmount(amountInput);
  const card = await resolveCard(userId, cardId);
  if ((card.balance ?? 0) < amount) {
    throw new WalletError(400, 'Card has insufficient funds');
  }

  const now = new Date().toISOString();
  card.balance = (card.balance ?? 0) - amount;
  card.updated_at = now;
  wallet.balance = (wallet.balance ?? 0) + amount;
  wallet.updated_at = now;

  await Promise.all([
    card.save(),
    wallet.save(),
    WalletTx.create({
      _id: randomUUID(),
      user_id: userId,
      type: 'TOPUP',
      amount,
      card_id: card._id,
      card_last4: card.last4,
      status: 'SUCCESS',
      created_at: now,
    }),
  ]);

  await createNotification({
    userId,
    type: 'SYSTEM',
    title: 'Top-up successful',
    body: `$${amount.toLocaleString('en-US')} was added to your wallet.`,
    actionRoute: '/wallet_loyalty',
  });

  return (await getWalletOverview(userId))!;
}

export async function withdraw(
  userId: string,
  amountInput: unknown,
  cardId?: string,
): Promise<WalletOverviewResponse> {
  const wallet = await Wallet.findOne({ user_id: userId });
  if (!wallet) throw new WalletError(404, 'Wallet not found');
  const user = await User.findById(userId).lean();
  await ensureDefaultCard(userId, user?.full_name);

  const amount = assertAmount(amountInput);
  if ((wallet.balance ?? 0) < amount) {
    throw new WalletError(400, 'Wallet has insufficient funds');
  }
  const card = await resolveCard(userId, cardId);

  const now = new Date().toISOString();
  wallet.balance = (wallet.balance ?? 0) - amount;
  wallet.updated_at = now;
  card.balance = (card.balance ?? 0) + amount;
  card.updated_at = now;

  await Promise.all([
    card.save(),
    wallet.save(),
    WalletTx.create({
      _id: randomUUID(),
      user_id: userId,
      type: 'WITHDRAW',
      amount,
      card_id: card._id,
      card_last4: card.last4,
      status: 'SUCCESS',
      created_at: now,
    }),
  ]);

  await createNotification({
    userId,
    type: 'SYSTEM',
    title: 'Withdrawal complete',
    body: `$${amount.toLocaleString('en-US')} was moved to your card ending ${card.last4}.`,
    actionRoute: '/wallet_transactions',
  });

  return (await getWalletOverview(userId))!;
}

export async function createCard(
  userId: string,
  input: {
    brand?: string;
    last4?: string;
    holderName?: string;
  },
): Promise<WalletOverviewResponse> {
  const wallet = await Wallet.findOne({ user_id: userId }).lean();
  if (!wallet) throw new WalletError(404, 'Wallet not found');

  const existing = await Card.countDocuments({ user_id: userId });
  const rawLast4 = (input.last4 ?? '').replace(/\D/g, '');
  const last4 =
    rawLast4.length >= 4 ? rawLast4.slice(-4) : String(Math.floor(1000 + Math.random() * 9000));
  const now = new Date().toISOString();

  await Card.create({
    _id: randomUUID(),
    user_id: userId,
    brand: input.brand?.trim() || 'VISA',
    last4,
    holder_name: input.holderName?.trim() || null,
    balance: CARD_SEED_BALANCE,
    is_default: existing === 0,
    created_at: now,
    updated_at: now,
  });

  return (await getWalletOverview(userId))!;
}
