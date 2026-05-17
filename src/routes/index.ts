import { Router } from 'express';
import activitiesRoutes from './activities.route';
import homeRoutes from './home.route';
import healthRoutes from './health.route';
import hotelsRoutes from './hotels.route';
import inventoryRoutes from './inventory.route';
import ordersRoutes from './orders.route';
import searchRoutes from './search.route';
import tripsRoutes from './trips.route';
import walletRoutes from './wallet.route';

const router = Router();

router.use('/activities', activitiesRoutes);
router.use('/home', homeRoutes);
router.use('/health', healthRoutes);
router.use('/hotels', hotelsRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/orders', ordersRoutes);
router.use('/search', searchRoutes);
router.use('/trips', tripsRoutes);
router.use('/wallet', walletRoutes);

export default router;
