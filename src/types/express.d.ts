export {};

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        expiresAt: string;
        role: 'PLANNER' | 'PROVIDER';
      };
    }
  }
}
