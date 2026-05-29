import { Router } from 'express';
import {
  acceptOrderHandler,
  getProviderOrdersHandler,
  lookupProviderTicketHandler,
  updateOrderStatusHandler,
} from '@/controllers/orders.controller';

const router = Router();

router.get('/', getProviderOrdersHandler);
router.get('/tickets/:code', lookupProviderTicketHandler);
router.patch('/:id/status', updateOrderStatusHandler);
router.post('/:id/accept', acceptOrderHandler);

export default router;
