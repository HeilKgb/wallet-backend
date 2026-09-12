import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { LoginDto, LoginSocialDto, RegisterLocalDto, RegisterSocialDto, UpdateUserDto, UserResponseDto } from './dto/login.dto';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { Public } from '../auth/public.decorator';
import { OwnResourceGuard } from '../auth/own-resource.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterLocalDto): Promise<AuthResponseDto> {
    return this.usersService.registerLocal(dto);
  }

  @Public()
  @Post('register/social')
  registerSocial(@Body() dto: RegisterSocialDto): Promise<AuthResponseDto> {
    return this.usersService.registerSocial(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.usersService.login(dto);
  }

  @Public()
  @Post('login/social')
  @HttpCode(HttpStatus.OK)
  loginSocial(@Body() dto: LoginSocialDto): Promise<AuthResponseDto> {
    return this.usersService.loginSocial(dto);
  }

  @Get(':id')
  @UseGuards(OwnResourceGuard)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @UseGuards(OwnResourceGuard)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(OwnResourceGuard)
  @HttpCode(HttpStatus.OK)
  freeze(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.freeze(id);
  }
}
