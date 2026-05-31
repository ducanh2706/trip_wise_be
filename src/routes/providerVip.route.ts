import { Router } from 'express';
import {
  getProviderVipHandler,
  selectProviderPromotionHandler,
  updateProviderVipAutoRenewHandler,
  upgradeProviderToEliteHandler,
} from '@/controllers/providerVip.controller';

const router = Router();

router.get('/', getProviderVipHandler);
router.post('/upgrade', upgradeProviderToEliteHandler);
router.patch('/auto-renew', updateProviderVipAutoRenewHandler);
router.post('/promotions/select', selectProviderPromotionHandler);

export default router;
