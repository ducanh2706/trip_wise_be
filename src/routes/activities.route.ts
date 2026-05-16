import { Router } from 'express';
import { getActivitiesHandler } from '@/controllers/activities.controller';

const router = Router();

router.get('/', getActivitiesHandler);

export default router;
