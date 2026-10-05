import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { type FieldError, ValidationFailedError } from '../domain/domain-error';

/** STACK §3: strip nothing silently; unknown fields are an error. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedError(flattenValidationErrors(errors)),
  });
}

/** `[{ field: 'blocks.0.startTime', message: 'startTime must be HH:mm' }]` */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
