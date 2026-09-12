import { UserResponseDto } from '../../users/dto/login.dto';

/** Retornado pelas rotas de cadastro e login: dados do usuário + token de acesso. */
export class AuthResponseDto {
  user: UserResponseDto;
  accessToken: string;
}
