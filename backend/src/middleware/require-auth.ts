
import type { Request, Response, NextFunction } from "express";
import { success } from "zod";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      error: "Unauthorized. Please log in.",
    });
  }

  next();
}
