import type { Request } from 'express';

/** Who is calling, taken from the access token. */
export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
