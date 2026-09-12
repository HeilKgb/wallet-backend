import { Exclude, Expose } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthProvider, UserStatus } from '../../common/enums';

export class LoginDto {
  @IsEmail({}, { message: 'email inválido' })
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}


export class LoginSocialDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class RegisterLocalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @IsEmail({}, { message: 'email inválido' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'a senha deve ter no mínimo 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'a senha deve conter ao menos uma letra e um número',
  })
  password: string;

  @IsString()
  @Length(11, 11, { message: 'CPF deve ter exatamente 11 dígitos' })
  @Matches(/^\d{11}$/, { message: 'CPF deve conter apenas números' })
  cpf: string;

  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'telefone deve conter apenas números (DDI+DDD+número)' })
  phoneNumber: string;
}

/**
 * O client NUNCA deve mandar o firebaseUid ou o provider diretamente — isso seria
 * fácil de forjar. Em vez disso, o client manda o idToken que recebeu do
 * Firebase Auth (após o usuário logar com Google/Apple), e o backend valida esse
 * token com o firebase-admin SDK, extraindo o uid e o provider (sign_in_provider)
 * de forma confiável a partir do token assinado.
 */
export class RegisterSocialDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @IsString()
  @Length(11, 11, { message: 'CPF deve ter exatamente 11 dígitos' })
  @Matches(/^\d{11}$/, { message: 'CPF deve conter apenas números' })
  cpf: string;

  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'telefone deve conter apenas números (DDI+DDD+número)' })
  phoneNumber: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email inválido' })
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'telefone deve conter apenas números (DDI+DDD+número)' })
  phoneNumber?: string;
}


/**
 * Nunca inclui password_hash nem firebase_uid na resposta ao client.
 * Use `plainToInstance(UserResponseDto, row, { excludeExtraneousValues: true })`
 * ao montar a resposta a partir da linha retornada pelo banco.
 */
@Exclude()
export class UserResponseDto {
  @Expose() id: string;
  @Expose() fullName: string;
  @Expose() email: string;
  @Expose() cpf: string;
  @Expose() phoneNumber: string;
  @Expose() authProvider: AuthProvider;
  @Expose() status: UserStatus;
  @Expose() createdAt: Date;
}
