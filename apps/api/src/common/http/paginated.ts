import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_LIMIT = 100;

/** `?page=1&limit=20`, `limit ≤ 100` (API-DESIGN §1). Extend it in list DTOs. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = 20;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Return this from a list endpoint; the envelope interceptor turns it into `{ data, meta }`. */
export class Paginated<T> {
  constructor(
    readonly items: readonly T[],
    readonly total: number,
    readonly page: number,
    readonly limit: number,
  ) {}

  get meta(): PageMeta {
    return {
      page: this.page,
      limit: this.limit,
      total: this.total,
      totalPages: Math.ceil(this.total / this.limit),
    };
  }
}
