import { Router } from 'express';
import {
  getProviderVipHandler,
  selectProviderPromotionHandler,
  upgradeProviderToEliteHandler,
} from '@/controllers/providerVip.controller';

const router = Router();

router.get('/', getProviderVipHandler);
router.post('/upgrade', upgradeProviderToEliteHandler);
router.post('/promotions/select', selectProviderPromotionHandler);

export default router;
