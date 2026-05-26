import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
  testPushHandler,
} from '@/controllers/devices.controller';

const router = Router();

router.post('/', registerDeviceHandler);
router.delete('/', unregisterDeviceHandler);

// Debug helper. Gated by NODE_ENV so a production deploy can't be self-spammed
// by any logged-in user. Flip the env to re-enable for dev/staging.
router.post('/test-push', (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  testPushHandler(req, res, next);
});

export default router;
