import {
  GuardFailedError,
  InvalidTransitionError,
  makeMachine,
  type Transition,
} from './state-machine';

type S = 'DRAFT' | 'FINALIZED';
type A = 'generate' | 'finalize' | 'reopen';
interface Ctx {
  blockingFlags: number;
  reason?: string;
}

// Shaped like the Phase 1 DTR table (BUSINESS-RULES §7.1); the real one lands in BE-024.
const table: Transition<S, A, Ctx>[] = [
  { action: 'generate', from: ['DRAFT'], to: 'DRAFT' },
  {
    action: 'finalize',
    from: ['DRAFT'],
    to: 'FINALIZED',
    guard: (c) => (c.blockingFlags > 0 ? 'DTR_HAS_BLOCKING_FLAGS' : true),
  },
  { action: 'reopen', from: ['FINALIZED'], to: 'DRAFT', guard: (c) => Boolean(c.reason) },
];

const machine = makeMachine(table, { invalidTransitionCode: 'DTR_INVALID_TRANSITION' });
const ok: Ctx = { blockingFlags: 0, reason: 'typo in remarks' };

describe('makeMachine', () => {
  it.each<[S, A, S]>([
    ['DRAFT', 'generate', 'DRAFT'],
    ['DRAFT', 'finalize', 'FINALIZED'],
    ['FINALIZED', 'reopen', 'DRAFT'],
  ])('%s --%s--> %s', (from, action, to) => {
    expect(machine.transition(from, action, ok)).toBe(to);
  });

  it.each<[S, A]>([
    ['FINALIZED', 'finalize'],
    ['FINALIZED', 'generate'],
    ['DRAFT', 'reopen'],
  ])('refuses %s --%s with the machine code', (from, action) => {
    const attempt = () => machine.transition(from, action, ok);
    expect(attempt).toThrow(InvalidTransitionError);
    expect(attempt).toThrow(
      expect.objectContaining({ code: 'DTR_INVALID_TRANSITION', details: { from, action } }),
    );
  });

  it('a guard returning a code refuses with that code', () => {
    expect(() => machine.transition('DRAFT', 'finalize', { blockingFlags: 2 })).toThrow(
      expect.objectContaining({ code: 'DTR_HAS_BLOCKING_FLAGS', kind: 'BUSINESS_RULE' }),
    );
  });

  it('a guard returning false refuses with the machine code', () => {
    const attempt = () => machine.transition('FINALIZED', 'reopen', { blockingFlags: 0 });
    expect(attempt).toThrow(GuardFailedError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'DTR_INVALID_TRANSITION' }));
  });

  it('lists allowed actions per status without evaluating guards', () => {
    expect(machine.allowedActions('DRAFT')).toEqual(['generate', 'finalize']);
    expect(machine.allowedActions('FINALIZED')).toEqual(['reopen']);
  });

  it('rejects an ambiguous table at construction', () => {
    expect(() =>
      makeMachine<S, A, Ctx>(
        [
          { action: 'finalize', from: ['DRAFT'], to: 'FINALIZED' },
          { action: 'finalize', from: ['DRAFT'], to: 'DRAFT' },
        ],
        { invalidTransitionCode: 'DTR_INVALID_TRANSITION' },
      ),
    ).toThrow(/DRAFT:finalize appears twice/);
  });
});
