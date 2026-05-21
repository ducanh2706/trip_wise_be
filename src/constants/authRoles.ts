export const AUTH_ROLES = ['ADMIN', 'PROVIDER', 'PLANNER'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export function parseAuthRole(value: unknown): AuthRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'ADMIN') return 'ADMIN';
  if (normalized === 'PROVIDER') return 'PROVIDER';
  if (normalized === 'PLANNER' || normalized === 'USER') return 'PLANNER';
  return null;
}

export function normalizeStoredRole(value: unknown): AuthRole {
  return parseAuthRole(value) ?? 'PLANNER';
}
