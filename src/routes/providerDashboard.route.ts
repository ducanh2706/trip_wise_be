import { Router } from 'express';
import { getProviderDashboardHandler } from '@/controllers/providerDashboard.controller';

const router = Router();

router.get('/', getProviderDashboardHandler);

export default router;
