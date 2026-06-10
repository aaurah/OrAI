import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

declare global {
  namespace Express {
    interface Request {
      currentUserId?: string;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_API_PATHS = new Set(["/healthz"]);

function requestHost(req: Request): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  return (host ?? req.headers.host ?? "").split(",")[0].trim().toLowerCase();
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  const originHostName = originHost(origin);
  const host = requestHost(req);
  if (originHostName && host && originHostName === host) return next();

  res.status(403).json({ error: "Cross-origin mutation blocked" });
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_API_PATHS.has(req.path)) return next();

  const hasClerk = Boolean(process.env.CLERK_SECRET_KEY);

  if (!hasClerk) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Authentication is not configured" });
      return;
    }

    req.currentUserId = process.env.ORAI_DEV_USER_ID || "dev-user";
    return next();
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.currentUserId = userId;
  next();
}

export function requireDangerousActionConfirmation(action: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const confirmedAction = req.headers["x-orai-confirm-action"];
    if (confirmedAction === action) return next();

    res.status(428).json({
      error: "Explicit confirmation required",
      action,
      header: "x-orai-confirm-action",
    });
  };
}

export function previewSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    [
      "sandbox allow-scripts allow-forms",
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "font-src data:",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  );
  next();
}
