import { Router } from 'express';
import { cancelMyTripHandler, getMyTripsHandler } from '@/controllers/myTrips.controller';

const router = Router();

router.get('/', getMyTripsHandler);
router.post('/:bookingItemId/cancel', cancelMyTripHandler);

export default router;
