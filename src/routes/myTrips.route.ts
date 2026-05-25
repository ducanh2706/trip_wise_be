import { Router } from 'express';
import {
  cancelMyTripHandler,
  getMyTripDetailHandler,
  getMyTripsHandler,
} from '@/controllers/myTrips.controller';

const router = Router();

router.get('/', getMyTripsHandler);
router.get('/:bookingItemId', getMyTripDetailHandler);
router.post('/:bookingItemId/cancel', cancelMyTripHandler);

export default router;
