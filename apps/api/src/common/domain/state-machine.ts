import type { ErrorCode } from '@cvsu-dtr/shared';
import { DomainError } from './domain-error';

/**
 * One row of a transition table (DESIGN-PATTERNS §4). A guard returns `true` to allow,
 * `false` to refuse with the machine's default code, or an error code to refuse with that code.
 * Role checks stay in the application layer; tables only know states and guards.
 */
export interface Transition<S extends string, A extends string, C> {
  action: A;
  from: readonly S[];
  to: S;
  guard?: (ctx: C) => boolean | ErrorCode;
}

export interface MachineOptions {
  /** e.g. `DTR_INVALID_TRANSITION`, `IMPORT_INVALID_TRANSITION` */
  invalidTransitionCode: ErrorCode;
}

export interface Machine<S extends string, A extends string, C> {
  /** Returns the target status, or throws InvalidTransitionError / GuardFailedError. */
  transition(from: S, action: A, ctx: C): S;
  /** Actions whose `from` includes the status. Guards are not evaluated. */
  allowedActions(from: S): A[];
}

export class InvalidTransitionError extends DomainError {
  constructor(code: ErrorCode, from: string, action: string) {
    super(code, `Action "${action}" is not allowed from status ${from}.`, {
      details: { from, action },
    });
  }
}

export class GuardFailedError extends DomainError {
  constructor(code: ErrorCode, from: string, action: string) {
    super(code, `Action "${action}" is not allowed in the current state.`, {
      details: { from, action },
    });
  }
}

export function makeMachine<S extends string, A extends string, C>(
  table: readonly Transition<S, A, C>[],
  options: MachineOptions,
): Machine<S, A, C> {
  assertNoAmbiguity(table);

  return {
    transition(from, action, ctx) {
      const row = table.find((t) => t.action === action && t.from.includes(from));
      if (!row) throw new InvalidTransitionError(options.invalidTransitionCode, from, action);

      const verdict = row.guard ? row.guard(ctx) : true;
      if (verdict === true) return row.to;
      const code = verdict === false ? options.invalidTransitionCode : verdict;
      throw new GuardFailedError(code, from, action);
    },
    allowedActions(from) {
      return [...new Set(table.filter((t) => t.from.includes(from)).map((t) => t.action))];
    },
  };
}

/** A table with two rows for the same (from, action) is a bug: fail at startup, not at runtime. */
function assertNoAmbiguity<S extends string, A extends string, C>(
  table: readonly Transition<S, A, C>[],
): void {
  const seen = new Set<string>();
  for (const row of table) {
    for (const from of row.from) {
      const key = `${from}:${row.action}`;
      if (seen.has(key)) throw new Error(`Ambiguous transition table: ${key} appears twice`);
      seen.add(key);
    }
  }
}
