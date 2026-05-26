import cron, { type ScheduledTask } from 'node-cron';
import { Trip } from '@/models/Trip.model';
import { createNotification } from '@/services/notifications.service';

// Lightweight background scheduler. Three jobs today, all driven by trip
// dates. Each job uses a deterministic notification id (tripId + date) so
// duplicate runs (worker restart mid-day, scheduler firing twice on a date
// boundary) are idempotent — see createNotification's E11000 handler.
//
// Single-process only. If the server ever scales horizontally, add a leader
// election or move these to a real job queue.

let started = false;
const tasks: ScheduledTask[] = [];

/** YYYY-MM-DD for a date offset from today (UTC, mirrors how Trip.start_date is stored). */
function ymdOffset(days: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TripRow {
  _id: string;
  user_id: string;
  title?: string | null;
  destination?: string | null;
}

async function notifyTripsStartingOn(
  ymd: string,
  kind: '7d' | '1d',
  buildTitle: (trip: TripRow) => string,
  buildBody: (trip: TripRow) => string,
): Promise<void> {
  const trips = (await Trip.find({
    start_date: ymd,
    status: { $ne: 'COMPLETED' },
  })
    .select({ _id: 1, user_id: 1, title: 1, destination: 1 })
    .lean()) as TripRow[];

  for (const trip of trips) {
    if (!trip.user_id) continue;
    await createNotification({
      id: `reminder-trip-start-${kind}-${trip._id}-${ymd}`,
      userId: trip.user_id,
      type: 'TRIP',
      title: buildTitle(trip),
      body: buildBody(trip),
      actionRoute: `/trip_planner_timeline?id=${trip._id}`,
    });
  }
}

async function runTripStartsTomorrow(): Promise<void> {
  const tomorrow = ymdOffset(1);
  await notifyTripsStartingOn(
    tomorrow,
    '1d',
    () => 'Your trip starts tomorrow',
    (t) => {
      const name = (t.title?.trim() || 'Your trip').toString();
      const dest = (t.destination?.trim() || '').toString();
      return dest ? `${name} to ${dest} begins tomorrow.` : `${name} begins tomorrow.`;
    },
  );
}

async function runTripStartsIn7Days(): Promise<void> {
  const ymd = ymdOffset(7);
  await notifyTripsStartingOn(
    ymd,
    '7d',
    () => 'Your trip is one week away',
    (t) => {
      const name = (t.title?.trim() || 'Your trip').toString();
      const dest = (t.destination?.trim() || '').toString();
      return dest
        ? `${name} to ${dest} starts in 7 days. Time to finalize your itinerary.`
        : `${name} starts in 7 days. Time to finalize your itinerary.`;
    },
  );
}

async function runReviewPrompt(): Promise<void> {
  // Trips that ended 3 days ago: warm enough to remember, cold enough that the
  // user is back home and reflective. Skip cancelled/non-completed trips.
  const ymd = ymdOffset(-3);
  const trips = (await Trip.find({
    end_date: ymd,
    status: 'COMPLETED',
  })
    .select({ _id: 1, user_id: 1, title: 1 })
    .lean()) as TripRow[];

  for (const trip of trips) {
    if (!trip.user_id) continue;
    const name = (trip.title?.trim() || 'your recent trip').toString();
    await createNotification({
      id: `reminder-review-${trip._id}-${ymd}`,
      userId: trip.user_id,
      type: 'BOOKING',
      title: 'How was your trip?',
      body: `Share a quick review of ${name} — it helps other travelers.`,
      actionRoute: '/my_trips?status=completed',
    });
  }
}

/** Wraps a job so a single failure doesn't kill the cron task. */
function safe(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler] ${name} failed`, err);
    }
  };
}

/**
 * Start cron-driven notification jobs. Idempotent — calling twice is a no-op.
 *
 * Disable explicitly with SCHEDULER_ENABLED=false (handy for tests or when
 * running multiple instances behind a real queue).
 */
export function startScheduler(): void {
  if (started) return;
  if (process.env.SCHEDULER_ENABLED === 'false') {
    console.log('[scheduler] disabled via SCHEDULER_ENABLED=false');
    return;
  }
  if (process.env.NODE_ENV === 'test') return;

  started = true;

  // Cron strings are server-local. Spread the jobs across the morning so a
  // restart catches a missed run quickly without all three running at once.
  tasks.push(cron.schedule('0 9 * * *', safe('trip-start-7d', runTripStartsIn7Days)));
  tasks.push(cron.schedule('0 18 * * *', safe('trip-start-1d', runTripStartsTomorrow)));
  tasks.push(cron.schedule('0 10 * * *', safe('review-prompt', runReviewPrompt)));

  console.log(
    `[scheduler] 3 jobs scheduled: trip-start-7d (09:00), trip-start-1d (18:00), review-prompt (10:00)`,
  );
}

/** Exposed for tests / manual triggering. */
export const __schedulerJobs = {
  runTripStartsTomorrow,
  runTripStartsIn7Days,
  runReviewPrompt,
};
