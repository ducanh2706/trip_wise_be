import { Router } from 'express';
import { getInventoryHandler } from '@/controllers/inventory.controller';

const router = Router();

router.get('/', getInventoryHandler);

export default router;
