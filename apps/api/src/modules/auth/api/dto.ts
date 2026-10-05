import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../domain/password-policy';

export class LoginDto {
  @ApiProperty({ example: 'hr.admin@cvsu.edu.ph' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No policy check here: login only compares. The length cap keeps argon2 input bounded.
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  /** The full policy (length, breached list) runs in the service so all problems come back at once. */
  @ApiProperty({ format: 'password', minLength: 12 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH * 4)
  newPassword!: string;
}
