import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Actor } from '../../../common/actor';
import { AppConfig } from '../../../config/app-config';
import { type AccessTokenClaims, AuthService } from '../application/auth.service';

/** Verifies the Bearer access token (HS256 only), then checks it against the user's `ver`. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfig,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  validate(claims: AccessTokenClaims): Promise<Actor> {
    return this.auth.actorFor(claims);
  }
}
