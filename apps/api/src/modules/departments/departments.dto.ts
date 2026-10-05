import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { trim, trimToNull } from '../../common/http/validators';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'CAS', description: 'Short unique code, uppercase' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, {
    message: 'code must be 1–20 letters, digits, - or _',
  })
  code!: string;

  @ApiProperty({ example: 'College of Arts and Sciences' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ example: 'Main', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 100)
  campus?: string | null;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class ListDepartmentsQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface DepartmentView {
  id: string;
  code: string;
  name: string;
  campus: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
