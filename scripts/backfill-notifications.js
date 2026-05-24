// Seed a `notifications` collection (in-app inbox) for the demo user - no
// notification data exists. Entries reference the demo user's REAL trips,
// payments and trip companions so the feed is consistent with the rest of
// the app. Full rebuild, deterministic, safe to re-run.
//
// Also upserts a default `notification_preferences` doc (the API would
// lazily create one anyway via ensureDefaultPreferences, but seeding it
// keeps the settings screen consistent with this script).
//
// Run with:  node scripts/backfill-notifications.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

// Demo user - same one the wallet / trips slices pin; see src/config/env.ts.
const DEMO_USER_ID = '337b6ec4-bd20-474c-9318-5898cfba516e';

// The N most-recent notifications stay unread; everything older is read.
const UNREAD_COUNT = 7;

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const fmtUsd = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const r = rng(0x7c0ffee5);

  const trips = await db
    .collection('trips')
    .find({ user_id: DEMO_USER_ID })
    .sort({ _id: 1 })
    .toArray();
  const payments = await db
    .collection('payments')
    .find({ user_id: DEMO_USER_ID })
    .sort({ created_at: -1 })
    .limit(6)
    .toArray();

  // Real trip companions become MESSAGE senders.
  const companions = [];
  for (const t of trips) {
    for (const d of t.days || []) {
      for (const it of d.items || []) {
        for (const c of it.companions || []) {
          if (c && c.name) companions.push(c.name);
        }
      }
    }
  }
  const companionPool = [...new Set(companions)];

  // Build a flat list of notifications (newest written last; created_at is
  // assigned afterwards so the most recent few land unread).
  const drafts = [];
  const add = (type, title, body, action_route) =>
    drafts.push({ type, title, body, action_route: action_route ?? null });

  // SYSTEM — onboarding / account.
  add(
    'SYSTEM',
    'Welcome to Tripwise ✨',
    'Your account is ready. Plan a trip, book stays, and earn loyalty points.',
    '/home',
  );
  add(
    'SYSTEM',
    'Secure your account',
    'Enable 2-step verification to keep your bookings and wallet safe.',
    '/security_privacy',
  );

  // TRIP — one per real trip, copy depends on status.
  for (const t of trips) {
    const dest = t.destination || t.title || 'your destination';
    const route = `/trip_planner_timeline?id=${t._id}`;
    if (t.status === 'UPCOMING') {
      add(
        'TRIP',
        `Your trip to ${dest} is coming up`,
        `“${t.title}” starts ${t.start_date}. Review your day-by-day itinerary.`,
        route,
      );
      const first = (t.days || [])[0]?.items?.[0];
      if (first) {
        add(
          'TRIP',
          `Reminder: ${first.title}`,
          `Scheduled for ${first.time} on day 1 of “${t.title}”.`,
          route,
        );
      }
    } else if (t.status === 'ONGOING') {
      add(
        'TRIP',
        `Today's plan for ${dest} is ready`,
        `Your itinerary for “${t.title}” is set. Have a great trip!`,
        route,
      );
    } else {
      add(
        'TRIP',
        `How was ${dest}?`,
        `Share a review of the places you visited on “${t.title}”.`,
        '/my_trips',
      );
    }
  }

  // BOOKING — one per recent real payment.
  for (const p of payments) {
    const amount = fmtUsd(p.amount);
    const ref = p.booking_id ? `Booking ${p.booking_id}` : 'your booking';
    if ((p.status || '').toUpperCase() === 'PENDING') {
      add(
        'BOOKING',
        'Payment pending',
        `We're confirming your ${amount} payment for ${ref}.`,
        '/wallet_loyalty',
      );
    } else {
      add(
        'BOOKING',
        'Booking confirmed',
        `Your ${amount} payment for ${ref} was successful.`,
        '/wallet_loyalty',
      );
    }
  }

  // MESSAGE — from real trip companions.
  const msgLines = [
    'Can’t wait for this trip! 🎉',
    'I’ve added a few spots to our itinerary.',
    'Are we still on for the morning tour?',
    'Just booked my flight — see you there!',
  ];
  const senders = companionPool.length
    ? companionPool
    : ['Your travel buddy'];
  for (let i = 0; i < Math.min(4, senders.length + 1); i++) {
    const who = senders[i % senders.length];
    add(
      'MESSAGE',
      `New message from ${who}`,
      pick(r, msgLines),
      '/direct_messaging',
    );
  }

  // PROMO - generic offers (not user-specific).
  add(
    'PROMO',
    'Flash deal: 25% off beach resorts',
    'Limited-time discount on selected coastal stays. Ends this weekend.',
    '/home',
  );
  add(
    'PROMO',
    'Points on completed bookings',
    'Earn points equal to 1% of each completed booking.',
    '/wallet_loyalty',
  );
  add(
    'PROMO',
    'Use points at checkout',
    'Apply points for up to 20% off your current booking.',
    '/wallet_loyalty',
  );

  // Assign timestamps: spread over the last ~14 days, newest first.
  // Index 0 = most recent. created_at descending so the API's
  // sort({created_at:-1}) yields this exact order.
  const now = Date.now();
  const docs = drafts.map((d, i) => {
    // Gaps grow with age: recent items hours apart, old items ~1/day.
    const hoursAgo = i < UNREAD_COUNT ? i * 5 + 1 : (i - UNREAD_COUNT) * 22 + 40;
    const created = new Date(now - hoursAgo * 3600_000).toISOString();
    return {
      _id: randomUUID(),
      user_id: DEMO_USER_ID,
      type: d.type,
      title: d.title,
      body: d.body,
      read: i >= UNREAD_COUNT,
      action_route: d.action_route,
      created_at: created,
    };
  });

  const col = db.collection('notifications');
  await col.deleteMany({ user_id: DEMO_USER_ID });
  await col.insertMany(docs);
  await col.createIndex({ user_id: 1, created_at: -1 });
  await col.createIndex({ user_id: 1, read: 1 });

  // Default preferences doc (idempotent: _id IS the user id).
  await db.collection('notification_preferences').updateOne(
    { _id: DEMO_USER_ID },
    {
      $setOnInsert: {
        _id: DEMO_USER_ID,
        push: true,
        email: true,
        tripReminders: true,
        bookingUpdates: true,
        messages: true,
        promotions: false,
        updated_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  const unread = docs.filter((d) => !d.read).length;
  const byType = docs.reduce((m, d) => {
    m[d.type] = (m[d.type] || 0) + 1;
    return m;
  }, {});
  console.log(
    `notifications rebuilt: ${docs.length} for demo user ${DEMO_USER_ID} (${unread} unread)`,
  );
  console.log('  by type:', JSON.stringify(byType));
  console.log(
    `  trips=${trips.length} payments=${payments.length} companions=${companionPool.length}`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
