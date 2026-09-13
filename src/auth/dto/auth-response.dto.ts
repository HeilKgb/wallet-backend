import { UserResponseDto } from '../../users/dto/login.dto';

/** Retornado pelas rotas de cadastro e login: dados do usuário + par de tokens. */
export class AuthResponseDto {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
}
