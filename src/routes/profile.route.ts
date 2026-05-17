import { Router } from 'express';
import { getProfileHandler } from '@/controllers/profile.controller';

const router = Router();

router.get('/', getProfileHandler);

export default router;
