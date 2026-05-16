import { Router } from 'express';
import { getSearchHandler } from '@/controllers/search.controller';

const router = Router();

router.get('/', getSearchHandler);

export default router;
