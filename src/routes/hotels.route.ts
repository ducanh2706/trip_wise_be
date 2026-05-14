import { Router } from 'express';
import { getHotelDetailHandler } from '@/controllers/hotels.controller';

const router = Router();

router.get('/:id', getHotelDetailHandler);

export default router;
