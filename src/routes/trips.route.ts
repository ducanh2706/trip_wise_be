import { Router } from 'express';
import {
  getTripsHandler,
  createTripHandler,
  deleteTripHandler,
  addTripItemHandler,
  updateTripItemTimeHandler,
} from '@/controllers/trips.controller';

const router = Router();

router.get('/', getTripsHandler);
router.post('/', createTripHandler);
router.delete('/:id', deleteTripHandler);
router.post('/:id/items', addTripItemHandler);
router.patch('/:id/items/time', updateTripItemTimeHandler);

export default router;
