import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { type Env, validateEnv } from './env.schema';

/** Typed, validated configuration. Inject this instead of reading `process.env`. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}

@Global()
@Module({
  imports: [ConfigModule.forRoot({ validate: validateEnv, cache: true })],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
