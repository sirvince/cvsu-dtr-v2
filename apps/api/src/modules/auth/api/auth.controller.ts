import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { Actor } from '../../../common/actor';
import { CurrentActor, Public } from '../../../common/auth/decorators';
import { SessionExpiredError } from '../../../common/auth/errors';
import { requestContext } from '../../../common/http/request-context';
import { AuthService, type Me, type Session, type SessionUser } from '../application/auth.service';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../infrastructure/refresh-token';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { ChangePasswordDto, LoginDto } from './dto';

/** SECURITY-PRIVACY §2: never readable by scripts, never sent cross-site, only sent to /auth/*. */
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
};

interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // per IP (global guard) and per account
  @UseGuards(AccountThrottlerGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    return this.respond(res, await this.auth.login(dto.email, dto.password, requestContext(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const raw = readRefreshCookie(req);
    if (!raw) throw new SessionExpiredError();
    try {
      return this.respond(res, await this.auth.refresh(raw, requestContext(req)));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req), requestContext(req));
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(actor, requestContext(req));
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentActor() actor: Actor): Promise<Me> {
    return this.auth.me(actor);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const session = await this.auth.changePassword(
      actor,
      dto.currentPassword,
      dto.newPassword,
      requestContext(req),
    );
    return this.respond(res, session);
  }

  /** The refresh token goes into the cookie only; the body carries the access token. */
  private respond(res: Response, session: Session): TokenResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...COOKIE_OPTIONS,
      expires: session.refreshExpiresAt,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
