import { Router } from 'express';
import {
  getTripsHandler,
  createTripHandler,
  addTripItemHandler,
} from '@/controllers/trips.controller';

const router = Router();

router.get('/', getTripsHandler);
router.post('/', createTripHandler);
router.post('/:id/items', addTripItemHandler);

export default router;
