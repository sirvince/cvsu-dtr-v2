import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { Paginated } from './paginated';

const SKIP_ENVELOPE = 'skipEnvelope';

/** For handlers whose body is not an API resource: health probes, file streams. */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);

/** Success envelope (API-DESIGN §1): `{ data }`, or `{ data, meta }` for a Paginated result. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof Paginated) return { data: value.items, meta: value.meta };
        return { data: value ?? null };
      }),
    );
  }
}
