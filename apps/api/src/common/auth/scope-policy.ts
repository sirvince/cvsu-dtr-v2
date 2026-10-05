import { Injectable } from '@nestjs/common';
import type { ErrorCode } from '@cvsu-dtr/shared';
import { NotFoundError } from '../domain/domain-error';
import type { Actor } from '../actor';

/**
 * Department scope checks (API-DESIGN §3), called from use cases.
 * Phase 1 stub: HR_ADMIN sees everything, and nobody else can reach employee data.
 * Phase 1B adds EMPLOYEE (own record), HR_STAFF and DEPARTMENT_HEAD (user_department_scopes).
 */
@Injectable()
export class ScopePolicy {
  /** Out of scope is reported exactly like "does not exist": 404, never 403. */
  assertCanAccessEmployee(
    actor: Actor,
    _employeeId: string,
    notFound: ErrorCode = 'EMPLOYEE_NOT_FOUND',
  ): void {
    if (this.seesAllEmployees(actor)) return;
    throw new NotFoundError(notFound, 'Employee not found.');
  }

  /** For list queries: 'ALL', or the department ids to filter by in SQL (never filter in memory). */
  departmentFilter(actor: Actor): 'ALL' | readonly string[] {
    return this.seesAllEmployees(actor) ? 'ALL' : [];
  }

  private seesAllEmployees(actor: Actor): boolean {
    return actor.roles.includes('HR_ADMIN');
  }
}
