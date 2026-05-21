import { type AuthRole } from '@/constants/authRoles';

export {};

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        expiresAt: string;
        role: AuthRole;
      };
    }
  }
}
