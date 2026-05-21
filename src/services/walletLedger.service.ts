import { randomUUID } from 'crypto';
import { Wallet } from '@/models/Wallet.model';
import { WalletTx } from '@/models/WalletTransaction.model';
import { env } from '@/config/env';

export const PLATFORM_COMMISSION_RATE = env.platformCommissionRate;

export function calculateCommission(grossAmount: number): {
  grossAmount: number;
  commissionAmount: number;
  providerNetAmount: number;
} {
  const gross = Math.max(0, Math.round(grossAmount));
  const commission = Math.round(gross * PLATFORM_COMMISSION_RATE);
  return {
    grossAmount: gross,
    commissionAmount: commission,
    providerNetAmount: Math.max(gross - commission, 0),
  };
}

export async function ensureWallet(userId: string): Promise<void> {
  const existing = await Wallet.findOne({ user_id: userId }).lean();
  if (existing) return;

  const now = new Date().toISOString();
  await Wallet.create({
    _id: `wallet-${userId}`,
    user_id: userId,
    balance: 0,
    loyalty_points: 0,
    created_at: now,
    updated_at: now,
  });
}

export async function creditWallet(input: {
  userId: string;
  amount: number;
  type: string;
  status?: string;
  bookingId?: string | null;
  bookingItemId?: string | null;
  providerId?: string | null;
  note?: string | null;
}): Promise<void> {
  const amount = Math.round(input.amount);
  if (amount <= 0) return;

  await ensureWallet(input.userId);
  const now = new Date().toISOString();
  await Promise.all([
    Wallet.updateOne(
      { user_id: input.userId },
      {
        $inc: { balance: amount },
        $set: { updated_at: now },
      },
    ),
    WalletTx.create({
      _id: randomUUID(),
      user_id: input.userId,
      type: input.type,
      amount,
      card_id: 'system',
      card_last4: null,
      status: input.status ?? 'SUCCESS',
      booking_id: input.bookingId ?? null,
      booking_item_id: input.bookingItemId ?? null,
      provider_id: input.providerId ?? null,
      note: input.note ?? null,
      created_at: now,
    }),
  ]);
}

export async function debitWallet(input: {
  userId: string;
  amount: number;
  type: string;
  status?: string;
  bookingId?: string | null;
  bookingItemId?: string | null;
  providerId?: string | null;
  note?: string | null;
}): Promise<void> {
  const amount = Math.round(input.amount);
  if (amount <= 0) return;

  await ensureWallet(input.userId);
  const wallet = await Wallet.findOne({ user_id: input.userId });
  if (!wallet || (wallet.balance ?? 0) < amount) {
    throw new Error('Wallet has insufficient funds');
  }

  const now = new Date().toISOString();
  wallet.balance = (wallet.balance ?? 0) - amount;
  wallet.updated_at = now;
  await Promise.all([
    wallet.save(),
    WalletTx.create({
      _id: randomUUID(),
      user_id: input.userId,
      type: input.type,
      amount,
      card_id: 'system',
      card_last4: null,
      status: input.status ?? 'SUCCESS',
      booking_id: input.bookingId ?? null,
      booking_item_id: input.bookingItemId ?? null,
      provider_id: input.providerId ?? null,
      note: input.note ?? null,
      created_at: now,
    }),
  ]);
}
