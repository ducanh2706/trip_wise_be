import { Router } from 'express';
import homeRoutes from './home.route';
import healthRoutes from './health.route';
import hotelsRoutes from './hotels.route';
import searchRoutes from './search.route';
import walletRoutes from './wallet.route';

const router = Router();

router.use('/home', homeRoutes);
router.use('/health', healthRoutes);
router.use('/hotels', hotelsRoutes);
router.use('/search', searchRoutes);
router.use('/wallet', walletRoutes);

export default router;
