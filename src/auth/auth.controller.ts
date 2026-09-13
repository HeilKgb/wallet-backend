import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from './public.decorator';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenService, TokenPair } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly tokenService: TokenService) {}

  // Público: o access token de quem chama pode já estar expirado nesse momento.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.tokenService.rotateRefreshToken(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto): Promise<{ success: true }> {
    await this.tokenService.revokeFamily(dto.refreshToken);
    return { success: true };
  }
}
