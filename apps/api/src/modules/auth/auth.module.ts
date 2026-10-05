import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScopePolicy } from '../../common/auth/scope-policy';
import { AppConfig } from '../../config/app-config';
import { AuthController } from './api/auth.controller';
import { AuthService } from './application/auth.service';
import { UserAdminService } from './application/user-admin.service';
import { BREACHED_PASSWORDS, loadBreachedPasswords } from './infrastructure/breached-passwords';
import { AUTH_ENTITIES } from './infrastructure/entities';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { PasswordHasher } from './infrastructure/password-hasher';

/** Global so every module can inject ScopePolicy. The guards are registered in AppModule. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature(AUTH_ENTITIES),
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('JWT_ACCESS_TTL') },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserAdminService,
    PasswordHasher,
    JwtStrategy,
    ScopePolicy,
    { provide: BREACHED_PASSWORDS, useFactory: () => loadBreachedPasswords() },
  ],
  exports: [ScopePolicy, UserAdminService],
})
export class AuthModule {}
