import { Router } from 'express';
import {
  getFeedHandler,
  getSummaryHandler,
  getPreferencesHandler,
  updatePreferencesHandler,
  markAllReadHandler,
  markReadHandler,
} from '@/controllers/notifications.controller';

const router = Router();

// Literal segments before the `/:id/read` param route.
router.get('/', getFeedHandler);
router.get('/summary', getSummaryHandler);
router.get('/preferences', getPreferencesHandler);
router.put('/preferences', updatePreferencesHandler);
router.post('/read-all', markAllReadHandler);
router.post('/:id/read', markReadHandler);

export default router;
