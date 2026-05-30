import { Router } from 'express';
import {
  cancelMyTripHandler,
  createMyTripReviewHandler,
  getMyTripDetailHandler,
  getMyTripsHandler,
} from '@/controllers/myTrips.controller';

const router = Router();

router.get('/', getMyTripsHandler);
router.get('/:bookingItemId', getMyTripDetailHandler);
router.post('/:bookingItemId/cancel', cancelMyTripHandler);
router.post('/:bookingItemId/review', createMyTripReviewHandler);

export default router;
