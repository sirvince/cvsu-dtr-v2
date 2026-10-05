import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/app-config';
import { buildDataSourceOptions } from './data-source-options';

/** The app's connection, as app_user (DML only). Entities register themselves via forFeature. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        ...buildDataSourceOptions(config.get('DATABASE_URL')),
        // The app never runs migrations; the migrator role does, before deploy.
        migrations: [],
        autoLoadEntities: true,
        // docker compose may still be starting Postgres: retry for ~30 s, then fail startup.
        retryAttempts: 10,
        retryDelay: 3_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
