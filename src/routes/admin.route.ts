import { Router } from 'express';
import {
  listAdminCancellationRequestsHandler,
  listAdminListingsHandler,
  listAdminProviderPayoutsHandler,
  lookupAdminTicketHandler,
  listProviderApplicationsHandler,
  reviewProviderPayoutRequestsHandler,
  reviewCancellationRequestHandler,
  reviewAdminListingHandler,
  reviewProviderApplicationHandler,
} from '@/controllers/admin.controller';

const router = Router();

router.get('/provider-applications', listProviderApplicationsHandler);
router.get('/tickets/:code', lookupAdminTicketHandler);
router.patch('/provider-applications/:userId/review', reviewProviderApplicationHandler);
router.get('/listings', listAdminListingsHandler);
router.patch('/listings/:listingId/review', reviewAdminListingHandler);
router.get('/provider-payouts', listAdminProviderPayoutsHandler);
router.patch('/provider-payouts/:providerId/review', reviewProviderPayoutRequestsHandler);
router.get('/cancellations', listAdminCancellationRequestsHandler);
router.patch('/cancellations/:bookingItemId/review', reviewCancellationRequestHandler);

export default router;
