import { Router } from 'express';
import {
  getInventoryHandler,
  updateDayHandler,
  updateRulesHandler,
} from '@/controllers/inventory.controller';

const router = Router();

router.get('/', getInventoryHandler);
router.patch('/day', updateDayHandler);
router.put('/rules', updateRulesHandler);

export default router;
