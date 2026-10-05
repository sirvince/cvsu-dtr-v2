import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { Column, type DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Roles } from '../../common/auth/decorators';

/** DATABASE-MAPPING §5 */
@Entity('biometric_devices')
export class BiometricDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  location!: string | null;

  @Column({ type: 'text', nullable: true })
  model!: string | null;

  @Column({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber!: string | null;

  @Column({ type: 'text' })
  status!: 'ACTIVE' | 'INACTIVE';
}

export interface DeviceView {
  id: string;
  code: string;
  name: string;
  location: string | null;
  model: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

/** Phase 1 has one MB20 and no device UI (PHASE1-MVP §6): it is seeded, not managed. */
export const DEFAULT_DEVICE = {
  code: 'MAIN-01',
  name: 'Main biometric device',
  model: 'ZKTeco MB20',
};

@Injectable()
export class DevicesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(): Promise<DeviceView[]> {
    const rows = await this.dataSource
      .getRepository(BiometricDeviceEntity)
      .find({ order: { code: 'ASC' } });
    return rows.map(({ id, code, name, location, model, status }) => ({
      id,
      code,
      name,
      location,
      model,
      status,
    }));
  }

  /** Public: true when the device exists and is ACTIVE. */
  async isActive(id: string): Promise<boolean> {
    return this.dataSource.getRepository(BiometricDeviceEntity).existsBy({ id, status: 'ACTIVE' });
  }

  /** Idempotent seed of MAIN-01. Returns its id. */
  async ensureDefaultDevice(): Promise<string> {
    const repo = this.dataSource.getRepository(BiometricDeviceEntity);
    await repo
      .createQueryBuilder()
      .insert()
      .values({ ...DEFAULT_DEVICE, status: 'ACTIVE' })
      .orIgnore()
      .execute();
    const device = await repo.findOneByOrFail({ code: DEFAULT_DEVICE.code });
    return device.id;
  }
}

/** GET /biometric-devices: read-only in Phase 1, so HR can pick the device for a mapping. */
@ApiTags('devices')
@ApiBearerAuth()
@Controller('biometric-devices')
@Roles('HR_ADMIN', 'HR_STAFF', 'SYSTEM_ADMIN')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(): Promise<DeviceView[]> {
    return this.devices.list();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([BiometricDeviceEntity])],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
