import { Router } from 'express';
import healthRoutes from './health.route';
import hotelsRoutes from './hotels.route';

const router = Router();

router.use('/health', healthRoutes);
router.use('/hotels', hotelsRoutes);

export default router;
