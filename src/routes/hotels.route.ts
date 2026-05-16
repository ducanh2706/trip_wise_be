import { Router } from 'express';
import { getHotelDetailHandler } from '@/controllers/hotels.controller';
import { listHotelReviewsHandler } from '@/controllers/reviews.controller';

const router = Router();

router.get('/:id/reviews', listHotelReviewsHandler);
router.get('/:id', getHotelDetailHandler);

export default router;
