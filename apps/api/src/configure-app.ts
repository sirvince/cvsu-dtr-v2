import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { resolveRequestId } from './common/logging/pino-options';
import { AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';
const DOCS_PATH = 'api/docs';
const AUTH_PATH = `/${API_PREFIX}/auth`;

/**
 * HTTP setup shared by main.ts and the e2e tests (STACK §3, SECURITY-PRIVACY §4).
 * Pipes, the filter, the interceptor and the throttler guard are global providers in AppModule.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY'));
  app.disable('x-powered-by');

  // First, so that requests rejected by the body parser still carry a request ID.
  app.use((req: Request, res: Response, next: NextFunction) => {
    resolveRequestId(req, res);
    next();
  });

  // JSON routes: 1 MB. Upload routes set their own multipart limit (20 MB, BE-010).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  app.use(cookieParser());

  // The API only serves JSON and files, so its CSP is exactly the SECURITY-PRIVACY §4 baseline.
  const strictHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
    },
    // HSTS is set by Nginx (TLS terminates there).
    strictTransportSecurity: false,
  });
  // Swagger UI (non-production only) needs Helmet's defaults: inline styles, data: images.
  const docsHelmet = helmet({ strictTransportSecurity: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHelmet(req, res, next)
      : strictHelmet(req, res, next),
  );

  // Only the web app's origin. Cookies (refresh token) only travel to /auth/*.
  app.enableCors((req: Request, callback) =>
    callback(null, {
      origin: config.get('WEB_ORIGIN'),
      credentials: req.url.startsWith(AUTH_PATH),
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'If-Match',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );

  app.setGlobalPrefix(API_PREFIX);

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('CVSU DTR API').setVersion('1').addBearerAuth().build(),
    );
    SwaggerModule.setup(DOCS_PATH, app, document);
  }
}
