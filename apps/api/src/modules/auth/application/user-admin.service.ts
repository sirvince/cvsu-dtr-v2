import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Role } from '@cvsu-dtr/shared';
import { type DataSource, IsNull } from 'typeorm';
import { NotFoundError, ValidationFailedError } from '../../../common/domain/domain-error';
import { CLOCK, type Clock } from '../../../common/time/clock';
import { AuditService } from '../../audit/audit.service';
import { checkPassword } from '../domain/password-policy';
import { BREACHED_PASSWORDS } from '../infrastructure/breached-passwords';
import { RefreshTokenEntity, UserEntity, UserRoleEntity } from '../infrastructure/entities';
import { PasswordHasher } from '../infrastructure/password-hasher';

export interface SetPasswordCommand {
  email: string;
  password: string;
  /** Create the user if it doesn't exist (first admin). */
  create: boolean;
  /** Roles to grant (added, never removed). */
  roles: Role[];
}

/**
 * Operator-only account setup, used by the `user:set-password` CLI (BE-004): there is no default
 * password, not even for the first admin. The invite/reset email flow comes in Phase 1B.
 */
@Injectable()
export class UserAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BREACHED_PASSWORDS) private readonly breached: ReadonlySet<string>,
  ) {}

  async setPassword(cmd: SetPasswordCommand): Promise<{ userId: string; created: boolean }> {
    const problems = checkPassword(
      cmd.password,
      { email: cmd.email, breached: this.breached },
      'password',
    );
    if (problems.length) throw new ValidationFailedError(problems);
    const passwordHash = await this.hasher.hash(cmd.password);
    const now = new Date(this.clock.now().epochMilliseconds);

    return this.dataSource.transaction(async (tx) => {
      const users = tx.getRepository(UserEntity);
      let user = await users.findOne({
        where: { email: cmd.email },
        lock: { mode: 'pessimistic_write' },
      });
      const created = !user;
      if (!user) {
        if (!cmd.create) throw new NotFoundError('NOT_FOUND', `No user with email ${cmd.email}.`);
        user = users.create({
          email: cmd.email,
          status: 'INVITED',
          failedLoginCount: 0,
          tokenVersion: 1,
        });
      }

      user.passwordHash = passwordHash;
      user.passwordChangedAt = now;
      user.status = 'ACTIVE';
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      user.tokenVersion = created ? 1 : user.tokenVersion + 1;
      user = await users.save(user);

      await tx
        .getRepository(RefreshTokenEntity)
        .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: now });
      if (cmd.roles.length) {
        await tx
          .createQueryBuilder()
          .insert()
          .into(UserRoleEntity)
          .values(cmd.roles.map((role) => ({ userId: user.id, role })))
          .orIgnore()
          .execute();
      }

      await this.audit.record(tx, {
        actor: null,
        action: created ? 'USER_CREATED' : 'USER_PASSWORD_SET',
        entityType: 'user',
        entityId: user.id,
        metadata: { via: 'cli', rolesGranted: cmd.roles },
      });
      return { userId: user.id, created };
    });
  }
}
