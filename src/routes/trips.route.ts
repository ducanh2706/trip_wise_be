import { Router } from 'express';
import { getTripsHandler } from '@/controllers/trips.controller';

const router = Router();

router.get('/', getTripsHandler);

export default router;
