import { randomUUID } from 'crypto';
import { Wallet } from '@/models/Wallet.model';
import { Payment } from '@/models/Payment.model';
import { User } from '@/models/User.model';
import { Card } from '@/models/Card.model';
import { WalletTx } from '@/models/WalletTransaction.model';
import { env } from '@/config/env';

// No loyalty-tier or points-rate data exists in the DB, so these are
// server-side config for the slice. Adjust freely; not persisted anywhere.
const POINT_VALUE_VND = 100;
const TIERS = [
  { name: 'SILVER', min: 0 },
  { name: 'GOLD', min: 5000 },
  { name: 'PLATINUM', min: 15000 },
];

// Every mock card is minted with this VND balance (≈ "30,000 USD" per the
// product ask, kept in VND so there is no currency conversion anywhere).
const CARD_SEED_BALANCE = 30_000_000;

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

function deriveTier(points: number): WalletOverviewResponse['tier'] {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (points >= TIERS[i].min) idx = i;
  }
  const current = TIERS[idx];
  const next = TIERS[idx + 1] ?? null;
  if (!next) {
    return { current: current.name, next: null, pointsToNext: null, progress: 1 };
  }
  const span = next.min - current.min;
  const into = points - current.min;
  return {
    current: current.name,
    next: next.name,
    pointsToNext: Math.max(next.min - points, 0),
    progress: span > 0 ? Math.min(Math.max(into / span, 0), 1) : 1,
  };
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
async function ensureDefaultCard(
  userId: string,
  userName?: string | null,
): Promise<void> {
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

  const fromPayments: Array<WalletTransaction & { _ts: number }> = payments.map(
    (p) => {
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
    },
  );

  const fromWallet: Array<WalletTransaction & { _ts: number }> = walletTxs.map(
    (t) => {
      const isTopup = t.type === 'TOPUP';
      const date = formatDate(t.created_at);
      const cardLabel = t.card_last4 ? `card •• ${t.card_last4}` : 'card';
      return {
        id: t._id,
        title: isTopup ? 'Wallet top-up' : 'Withdrawal',
        subtitle:
          (isTopup ? `From ${cardLabel}` : `To ${cardLabel}`) +
          (date ? ` • ${date}` : ''),
        method: t.type,
        amountVnd: isTopup ? Math.abs(t.amount) : -Math.abs(t.amount),
        status: t.status ?? 'SUCCESS',
        _ts: new Date(t.created_at ?? 0).getTime() || 0,
      };
    },
  );

  return [...fromPayments, ...fromWallet]
    .sort((a, b) => b._ts - a._ts)
    .map(({ _ts, ...rest }) => rest);
}

export async function getWalletOverview(): Promise<WalletOverviewResponse | null> {
  const userId = env.demoUserId;
  const wallet = await Wallet.findOne({ user_id: userId }).lean();
  if (!wallet) return null;

  const user = await User.findById(userId).lean();
  await ensureDefaultCard(userId, user?.full_name);

  const [cards, ledger] = await Promise.all([
    Card.find({ user_id: userId }).sort({ is_default: -1, created_at: 1 }).lean(),
    buildLedger(userId),
  ]);

  const points = wallet.loyalty_points ?? 0;

  return {
    user: user
      ? { id: user._id, name: user.full_name ?? 'Traveler', image: user.image ?? null }
      : null,
    balance: wallet.balance ?? 0,
    currency: 'VND',
    loyaltyPoints: points,
    pointsValueVnd: points * POINT_VALUE_VND,
    tier: deriveTier(points),
    cards: cards.map(mapCard),
    transactions: ledger.slice(0, 10),
  };
}

export async function getTransactionsPage(
  offset: number,
  limit: number,
): Promise<TransactionPage> {
  const userId = env.demoUserId;
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
  amountInput: unknown,
  cardId?: string,
): Promise<WalletOverviewResponse> {
  const userId = env.demoUserId;
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

  return (await getWalletOverview())!;
}

export async function withdraw(
  amountInput: unknown,
  cardId?: string,
): Promise<WalletOverviewResponse> {
  const userId = env.demoUserId;
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

  return (await getWalletOverview())!;
}

export async function createCard(input: {
  brand?: string;
  last4?: string;
  holderName?: string;
}): Promise<WalletOverviewResponse> {
  const userId = env.demoUserId;
  const wallet = await Wallet.findOne({ user_id: userId }).lean();
  if (!wallet) throw new WalletError(404, 'Wallet not found');

  const existing = await Card.countDocuments({ user_id: userId });
  const rawLast4 = (input.last4 ?? '').replace(/\D/g, '');
  const last4 =
    rawLast4.length >= 4
      ? rawLast4.slice(-4)
      : String(Math.floor(1000 + Math.random() * 9000));
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

  return (await getWalletOverview())!;
}
