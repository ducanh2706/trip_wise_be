import { Router } from 'express';
import {
  acceptOrderHandler,
  getProviderOrdersHandler,
  lookupProviderTicketHandler,
  rejectOrderHandler,
  updateOrderStatusHandler,
} from '@/controllers/orders.controller';

const router = Router();

router.get('/', getProviderOrdersHandler);
router.get('/tickets/:code', lookupProviderTicketHandler);
router.patch('/:id/status', updateOrderStatusHandler);
router.post('/:id/accept', acceptOrderHandler);
router.post('/:id/reject', rejectOrderHandler);

export default router;
