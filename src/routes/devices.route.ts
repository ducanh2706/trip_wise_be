import { Router } from 'express';
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
  testPushHandler,
} from '@/controllers/devices.controller';

const router = Router();

router.post('/', registerDeviceHandler);
router.delete('/', unregisterDeviceHandler);
router.post('/test-push', testPushHandler);

export default router;
