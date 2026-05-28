import { Router } from 'express';
import {
  getTripsHandler,
  createTripHandler,
  addTripItemHandler,
  updateTripItemTimeHandler,
} from '@/controllers/trips.controller';

const router = Router();

router.get('/', getTripsHandler);
router.post('/', createTripHandler);
router.post('/:id/items', addTripItemHandler);
router.patch('/:id/items/time', updateTripItemTimeHandler);

export default router;
