import { Router } from 'express';
import {
  completeCheckoutHandler,
  getCheckoutSummaryHandler,
} from '@/controllers/checkout.controller';

const router = Router();

router.get('/summary', getCheckoutSummaryHandler);
router.post('/complete', completeCheckoutHandler);

export default router;
