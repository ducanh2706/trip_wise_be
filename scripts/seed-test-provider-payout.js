const { randomUUID } = require('crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const email = (process.argv[2] || 'thang3@gmail.com').trim().toLowerCase();
const grossAmount = Math.round(Number(process.argv[3] || 100));
const adminWalletUserId = process.env.ADMIN_WALLET_USER_ID || 'tripwise-admin-wallet';
const demoUserId =
  process.env.DEMO_USER_ID || '337b6ec4-bd20-474c-9318-5898cfba516e';
const commissionRate = Math.min(
  Math.max(Number(process.env.PLATFORM_COMMISSION_RATE || 0.08) || 0.08, 0),
  0.5,
);

async function ensureWallet(db, userId, now) {
  await db.collection('wallets').updateOne(
    { user_id: userId },
    {
      $setOnInsert: {
        _id: `wallet-${userId}`,
        user_id: userId,
        balance: 0,
        loyalty_points: 0,
        created_at: now,
      },
      $set: { updated_at: now },
    },
    { upsert: true },
  );
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }
  if (!email.includes('@')) {
    throw new Error('Pass a valid email, e.g. thang3@gmail.com');
  }
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const now = new Date().toISOString();

  const user = await db.collection('users').findOne({
    $or: [{ email_normalized: email }, { email }],
  });
  if (!user) {
    throw new Error(`User not found for ${email}`);
  }

  const userId = String(user._id);
  const provider =
    (await db.collection('providers').findOne({
      $or: [{ _id: userId }, { user_id: userId }],
    })) || {};
  const providerId = provider._id || userId;
  const providerName =
    user.full_name || user.email || provider.business_name || 'Tripwise Provider';
  const commissionAmount = Math.round(grossAmount * commissionRate);
  const providerNetAmount = grossAmount - commissionAmount;
  const bookingId = randomUUID();
  const bookingItemId = randomUUID();

  await db.collection('users').updateOne(
    { _id: userId },
    {
      $set: {
        role: 'PROVIDER',
        updated_at: now,
      },
    },
  );

  await db.collection('providers').updateOne(
    { _id: providerId },
    {
      $set: {
        user_id: userId,
        business_name: providerName,
        status: 'APPROVED',
        updated_at: now,
      },
      $setOnInsert: {
        _id: providerId,
        created_at: now,
      },
    },
    { upsert: true },
  );

  await Promise.all([
    ensureWallet(db, userId, now),
    ensureWallet(db, adminWalletUserId, now),
  ]);

  await db.collection('bookings').insertOne({
    _id: bookingId,
    user_id: demoUserId,
    total_price: grossAmount,
    total_amount: grossAmount,
    discount_amount: 0,
    final_amount: grossAmount,
    currency: 'USD',
    status: 'PENDING',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  await db.collection('booking_items').insertOne({
    _id: bookingItemId,
    booking_id: bookingId,
    provider_id: providerId,
    room_id: null,
    flight_id: null,
    activity_id: null,
    start_date: now.slice(0, 10),
    end_date: now.slice(0, 10),
    quantity: 1,
    price_per_unit: grossAmount,
    total_price: grossAmount,
    gross_amount: grossAmount,
    commission_rate: commissionRate,
    commission_amount: commissionAmount,
    provider_net_amount: providerNetAmount,
    escrow_status: 'HELD',
    payout_request_id: null,
    paid_to_provider_at: null,
    item_status: 'PENDING',
    e_ticket_code: `TEST-${Date.now()}`,
    created_at: now,
    updated_at: now,
  });

  await db.collection('wallets').updateOne(
    { user_id: adminWalletUserId },
    {
      $inc: { balance: grossAmount },
      $set: { updated_at: now },
    },
  );

  await db.collection('wallet_transactions').insertOne({
    _id: randomUUID(),
    user_id: adminWalletUserId,
    type: 'BOOKING_ESCROW_IN',
    amount: grossAmount,
    card_id: 'system',
    card_last4: null,
    status: 'HELD',
    booking_id: bookingId,
    booking_item_id: bookingItemId,
    provider_id: providerId,
    note: `Test escrow for ${email}`,
    created_at: now,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        userId,
        providerId,
        grossAmount,
        commissionAmount,
        providerNetAmount,
        bookingItemId,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
