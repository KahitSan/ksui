// Ambient augmentation of the Express Request with the fields the host's auth
// middleware sets. Declared locally so the plugin type-checks standalone
// without importing host server code. At runtime these are erased; the host's
// own augmentation provides the real values.
import "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        is_active: boolean;
        username?: string | null;
        displayUsername?: string | null;
      };
      organizationId?: number;
      orgRole?: string;
      permissions?: string[];
      authMethod?: string;
    }
  }
}
