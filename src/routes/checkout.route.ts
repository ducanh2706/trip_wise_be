import { Router } from 'express';
import {
  completeCheckoutHandler,
  confirmCheckoutPayOSPaymentHandler,
  getCheckoutPayOSSessionHandler,
  getCheckoutSummaryHandler,
} from '@/controllers/checkout.controller';

const router = Router();

router.get('/summary', getCheckoutSummaryHandler);
router.post('/complete', completeCheckoutHandler);
router.get('/payos/session', getCheckoutPayOSSessionHandler);
router.post('/payos/confirm', confirmCheckoutPayOSPaymentHandler);

export default router;
