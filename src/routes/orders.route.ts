import { Router } from 'express';
import {
  acceptOrderHandler,
  getProviderOrdersHandler,
  updateOrderStatusHandler,
} from '@/controllers/orders.controller';

const router = Router();

router.get('/', getProviderOrdersHandler);
router.patch('/:id/status', updateOrderStatusHandler);
router.post('/:id/accept', acceptOrderHandler);

export default router;
