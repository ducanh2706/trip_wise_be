import { Router } from 'express';
import {
  createTestEscrowForProviderHandler,
  listAdminCancellationRequestsHandler,
  listAdminListingsHandler,
  listAdminProviderPayoutsHandler,
  listProviderApplicationsHandler,
  payProviderForPeriodHandler,
  reviewCancellationRequestHandler,
  reviewAdminListingHandler,
  reviewProviderApplicationHandler,
} from '@/controllers/admin.controller';

const router = Router();

router.get('/provider-applications', listProviderApplicationsHandler);
router.patch('/provider-applications/:userId/review', reviewProviderApplicationHandler);
router.get('/listings', listAdminListingsHandler);
router.patch('/listings/:listingId/review', reviewAdminListingHandler);
router.get('/provider-payouts', listAdminProviderPayoutsHandler);
router.post('/provider-payouts/test-escrow', createTestEscrowForProviderHandler);
router.post('/provider-payouts/:providerId/pay', payProviderForPeriodHandler);
router.get('/cancellations', listAdminCancellationRequestsHandler);
router.patch('/cancellations/:bookingItemId/review', reviewCancellationRequestHandler);

export default router;
