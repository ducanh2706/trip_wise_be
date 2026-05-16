import { Router } from 'express';
import {
  getTripsHandler,
  addTripItemHandler,
} from '@/controllers/trips.controller';

const router = Router();

router.get('/', getTripsHandler);
router.post('/:id/items', addTripItemHandler);

export default router;
