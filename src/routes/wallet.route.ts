import { Router } from 'express';
import {
  getWalletHandler,
  getTransactionsHandler,
  topUpHandler,
  withdrawHandler,
  createCardHandler,
} from '@/controllers/wallet.controller';

const router = Router();

router.get('/', getWalletHandler);
router.get('/transactions', getTransactionsHandler);
router.post('/topup', topUpHandler);
router.post('/withdraw', withdrawHandler);
router.post('/cards', createCardHandler);

export default router;
