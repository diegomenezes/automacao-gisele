import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../../config";

const COOKIE_NAME = "admin_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sign(value: string): string {
  return crypto
    .createHmac("sha256", config.admin.sessionSecret)
    .update(value)
    .digest("hex");
}

export function createSessionToken(): string {
  const payload = `${config.admin.user}:${Date.now()}`;
  return `${payload}:${sign(payload)}`;
}

export function verifySessionToken(token: string): boolean {
  const parts = token.split(":");
  if (parts.length < 3) return false;

  const timestamp = parseInt(parts[1], 10);
  if (Number.isNaN(timestamp)) return false;
  if (Date.now() - timestamp > SESSION_MAX_AGE_MS) return false;

  const payload = `${parts[0]}:${parts[1]}`;
  const expectedSig = parts[2];
  const actualSig = sign(payload);

  return expectedSig === actualSig && parts[0] === config.admin.user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (token && verifySessionToken(token)) {
    next();
    return;
  }
  res.redirect("/admin/login");
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    secure: config.server.nodeEnv === "production",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export const SESSION_COOKIE = COOKIE_NAME;
