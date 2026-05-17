import { Router } from 'express';
import { getPaymentSuccessHandler } from '@/controllers/payments.controller';

const router = Router();

router.get('/success', getPaymentSuccessHandler);
router.get('/success/:bookingId', getPaymentSuccessHandler);

export default router;
