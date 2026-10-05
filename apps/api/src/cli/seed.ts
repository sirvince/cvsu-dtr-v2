import { NestFactory } from '@nestjs/core';
import { DEFAULT_DEVICE, DevicesService } from '../modules/devices/devices.module';
import { CliModule } from './cli.module';

/**
 * Idempotent reference data: safe to run on every deploy. BE-009 extends it (rule set,
 * schedule template, periods). The first admin is created separately with user:set-password.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    const deviceId = await app.get(DevicesService).ensureDefaultDevice();
    console.log(`Device ${DEFAULT_DEVICE.code}: ${deviceId}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
