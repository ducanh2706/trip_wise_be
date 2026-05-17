import { Router } from 'express';
import { getMyTripsHandler } from '@/controllers/myTrips.controller';

const router = Router();

router.get('/', getMyTripsHandler);

export default router;
