// apps/api/src/modules/auth/auth.controller.ts
import type { NextFunction, Request, Response } from "express";
import { isProd } from "../../config/env";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "../../config/constants";
import { UnauthorizedError } from "../../utils/errors";
import * as authService from "./auth.service";

const REFRESH_COOKIE_PATH = "/api/auth";

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const base = {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
  };
  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    ...base,
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

function auditCtx(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.registerUser(req.body, auditCtx(req));
    setAuthCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
    res.status(201).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.loginUser(req.body, auditCtx(req));
    setAuthCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
    res.json({
      user: result.user,
      accessToken: result.tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) throw new UnauthorizedError("Refresh token manquant");
    const tokens = await authService.refreshSession(token);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

export function logout(_req: Request, res: Response): void {
  clearAuthCookies(res);
  res.status(204).end();
}

export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new UnauthorizedError();
    const user = await authService.getCurrentUser(req.user.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new UnauthorizedError();
    const user = await authService.updateProfile(req.user.id, req.body);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new UnauthorizedError();
    await authService.changePassword(req.user.id, req.body);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}