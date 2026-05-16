import { Router } from 'express';
import { getWalletHandler } from '@/controllers/wallet.controller';

const router = Router();

router.get('/', getWalletHandler);

export default router;
