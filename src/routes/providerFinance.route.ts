import { Router } from 'express';
import {
  getProviderFinanceHandler,
  listProviderPayoutRequestsHandler,
  requestProviderPayoutHandler,
} from '@/controllers/providerFinance.controller';

const router = Router();

router.get('/', getProviderFinanceHandler);
router.get('/payout-requests', listProviderPayoutRequestsHandler);
router.post('/payout-requests', requestProviderPayoutHandler);

export default router;
