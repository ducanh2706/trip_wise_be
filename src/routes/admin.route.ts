import { Router } from 'express';
import {
  createTestEscrowForProviderHandler,
  listAdminProviderPayoutsHandler,
  listProviderApplicationsHandler,
  payProviderForPeriodHandler,
  reviewProviderApplicationHandler,
} from '@/controllers/admin.controller';

const router = Router();

router.get('/provider-applications', listProviderApplicationsHandler);
router.patch('/provider-applications/:userId/review', reviewProviderApplicationHandler);
router.get('/provider-payouts', listAdminProviderPayoutsHandler);
router.post('/provider-payouts/test-escrow', createTestEscrowForProviderHandler);
router.post('/provider-payouts/:providerId/pay', payProviderForPeriodHandler);

export default router;
