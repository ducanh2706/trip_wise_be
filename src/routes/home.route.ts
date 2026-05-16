import { Router } from 'express';
import { getHomeHandler } from '@/controllers/home.controller';

const router = Router();

router.get('/', getHomeHandler);

export default router;
