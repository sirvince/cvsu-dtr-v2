import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATABASE-MAPPING §4 (users, roles, auth tokens) and §10 (audit_logs, ADR-41).
 * Runs as `migrator`. app_user gets explicit DML grants only.
 */
export class InitUsersAuth1791100000001 implements MigrationInterface {
  name = 'InitUsersAuth1791100000001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await q.query(`
      CREATE TABLE users (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email               citext NOT NULL UNIQUE,
        password_hash       text,
        status              text NOT NULL DEFAULT 'INVITED'
                            CHECK (status IN ('INVITED','ACTIVE','INACTIVE','LOCKED')),
        failed_login_count  int  NOT NULL DEFAULT 0,
        locked_until        timestamptz,
        last_login_at       timestamptz,
        password_changed_at timestamptz,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE user_roles (
        user_id    uuid NOT NULL REFERENCES users(id),
        role       text NOT NULL CHECK (role IN
                   ('SYSTEM_ADMIN','HR_ADMIN','HR_STAFF','DEPARTMENT_HEAD','EMPLOYEE')),
        granted_by uuid REFERENCES users(id),
        granted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role)
      )`);

    await q.query(`
      CREATE TABLE refresh_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id),
        family_id   uuid NOT NULL,
        token_hash  text NOT NULL UNIQUE,
        expires_at  timestamptz NOT NULL,
        revoked_at  timestamptz,
        replaced_by uuid REFERENCES refresh_tokens(id),
        ip          inet,
        user_agent  text,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    // Reuse detection revokes a whole family; logout-everywhere revokes per user.
    await q.query(`CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id)`);
    await q.query(`CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id)`);

    await q.query(`
      CREATE TABLE password_reset_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id),
        token_hash text NOT NULL UNIQUE,
        purpose    text NOT NULL CHECK (purpose IN ('INVITE','RESET')),
        expires_at timestamptz NOT NULL,
        used_at    timestamptz
      )`);

    await q.query(`
      CREATE TABLE audit_logs (
        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at   timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid,
        actor_roles   text[],
        action        text NOT NULL,
        entity_type   text NOT NULL,
        entity_id     uuid,
        request_id    text,
        ip            inet,
        user_agent    text,
        before        jsonb,
        after         jsonb,
        reason        text,
        metadata      jsonb
      )`);
    await q.query(
      `CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, occurred_at DESC)`,
    );
    await q.query(`CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, occurred_at DESC)`);

    // Master data is deactivated, never deleted (DATABASE-MAPPING §1).
    await q.query(`GRANT SELECT, INSERT, UPDATE ON users TO app_user`);
    // Removing a role or a used token is a real delete.
    await q.query(`GRANT SELECT, INSERT, DELETE ON user_roles TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO app_user`);
    // 🔒 Audit log is append-only.
    await q.query(`GRANT SELECT, INSERT ON audit_logs TO app_user`);
    await q.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE audit_logs`);
    await q.query(`DROP TABLE password_reset_tokens`);
    await q.query(`DROP TABLE refresh_tokens`);
    await q.query(`DROP TABLE user_roles`);
    await q.query(`DROP TABLE users`);
    await q.query(`DROP EXTENSION IF EXISTS btree_gist`);
    await q.query(`DROP EXTENSION IF EXISTS citext`);
    await q.query(`DROP EXTENSION IF EXISTS pgcrypto`);
  }
}
