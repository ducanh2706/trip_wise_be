import { Router } from 'express';
import { submitProviderApplicationHandler } from '@/controllers/providerApplications.controller';

const router = Router();

router.post('/', submitProviderApplicationHandler);

export default router;
