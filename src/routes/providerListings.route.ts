import { Router } from 'express';
import {
  createProviderListingHandler,
  deleteProviderListingHandler,
  getProviderListingAnalyticsHandler,
  getProviderListingDetailHandler,
  listProviderListingsHandler,
  replyToProviderListingReviewHandler,
  updateProviderListingHandler,
} from '@/controllers/providerListings.controller';

const router = Router();

router.get('/', listProviderListingsHandler);
router.post('/', createProviderListingHandler);
router.get('/:id', getProviderListingDetailHandler);
router.patch('/:id', updateProviderListingHandler);
router.post('/:id/reviews/:reviewId/reply', replyToProviderListingReviewHandler);
router.delete('/:id', deleteProviderListingHandler);
router.get('/:id/analytics', getProviderListingAnalyticsHandler);

export default router;
