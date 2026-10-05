import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { Role } from '@cvsu-dtr/shared';
import { DomainError } from '../common/domain/domain-error';
import { ClockModule } from '../common/time/clock.module';
import { AppConfigModule } from '../config/app-config';
import { DatabaseModule } from '../database/database.module';
import { UserAdminService } from '../modules/auth/application/user-admin.service';
import { AuditModule } from '../modules/audit/audit.module';
import { AuthModule } from '../modules/auth/auth.module';

const USAGE = `Set (or create) a user's password. There is no default password, not even for the first admin.

  yarn workspace @cvsu-dtr/api user:set-password --email <email> [--create] [--role HR_ADMIN ...]
  echo "$PASSWORD" | yarn workspace @cvsu-dtr/api user:set-password --email <email> --password-stdin

  --email           Defaults to SEED_ADMIN_EMAIL
  --create          Create the user if it doesn't exist
  --role            Role to grant (repeatable). Default with --create: HR_ADMIN
  --password-stdin  Read the password from stdin instead of prompting`;

// AuthModule's controller references the throttler guard, so the module must be present.
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    ThrottlerModule.forRoot([]),
  ],
})
class CliModule {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      create: { type: 'boolean', default: false },
      role: { type: 'string', multiple: true },
      'password-stdin': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const email = values.email ?? process.env.SEED_ADMIN_EMAIL;
  if (values.help || !email) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const roles = values.role ?? (values.create ? ['HR_ADMIN'] : []);
  const unknown = roles.filter((r) => !(Object.values(Role) as string[]).includes(r));
  if (unknown.length) throw new Error(`Unknown role(s): ${unknown.join(', ')}`);

  const password = values['password-stdin'] ? await readStdin() : await promptTwice();

  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    const result = await app.get(UserAdminService).setPassword({
      email,
      password,
      create: values.create,
      roles: roles as Role[],
    });
    console.log(
      `${result.created ? 'Created' : 'Updated'} ${email} (${result.userId}).` +
        (roles.length ? ` Roles granted: ${roles.join(', ')}.` : ''),
    );
  } finally {
    await app.close();
  }
}

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += String(chunk);
  return data.replace(/\r?\n$/, '');
}

async function promptTwice(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('No terminal to prompt in. Use --password-stdin.');
  const first = await promptHidden('New password: ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

/** Reads a line without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const writer = rl as unknown as { _writeToOutput: (s: string) => void };
    writer._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

main().catch((error: unknown) => {
  if (error instanceof DomainError && Array.isArray(error.details)) {
    console.error(
      `${error.message}\n${(error.details as { message: string }[]).map((d) => `  - ${d.message}`).join('\n')}`,
    );
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
