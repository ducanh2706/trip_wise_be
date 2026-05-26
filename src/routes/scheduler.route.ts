import { Router, type Request, type Response, type NextFunction } from 'express';
import { __schedulerJobs } from '@/services/scheduler.service';

const router = Router();

// Manual trigger for scheduler jobs. Exists so you can verify trip reminders
// and review prompts without waiting for the cron expression to fire (or
// editing your system clock). Same NODE_ENV gate as /devices/test-push — the
// real cron in scheduler.service.ts is the production driver.
//
//   POST /api/scheduler/run/trip-1d   → "Your trip starts tomorrow" reminders
//   POST /api/scheduler/run/trip-7d   → "Your trip is one week away" reminders
//   POST /api/scheduler/run/review    → review prompt (trips that ended 3 days ago)
router.post('/run/:job', async (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  try {
    const job = String(req.params.job);
    switch (job) {
      case 'trip-1d':
        await __schedulerJobs.runTripStartsTomorrow();
        break;
      case 'trip-7d':
        await __schedulerJobs.runTripStartsIn7Days();
        break;
      case 'review':
        await __schedulerJobs.runReviewPrompt();
        break;
      default:
        res
          .status(400)
          .json({ message: 'Unknown job. Use one of: trip-1d, trip-7d, review' });
        return;
    }
    res.json({ ok: true, job });
  } catch (err) {
    next(err);
  }
});

export default router;
