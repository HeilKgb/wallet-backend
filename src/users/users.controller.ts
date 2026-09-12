import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { LoginDto, LoginSocialDto, RegisterLocalDto, RegisterSocialDto, UpdateUserDto, UserResponseDto } from './dto/login.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  register(@Body() dto: RegisterLocalDto): Promise<UserResponseDto> {
    return this.usersService.registerLocal(dto);
  }

  @Post('register/social')
  registerSocial(@Body() dto: RegisterSocialDto): Promise<UserResponseDto> {
    return this.usersService.registerSocial(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<UserResponseDto> {
    return this.usersService.login(dto);
  }

  @Post('login/social')
  @HttpCode(HttpStatus.OK)
  loginSocial(@Body() dto: LoginSocialDto): Promise<UserResponseDto> {
    return this.usersService.loginSocial(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  freeze(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.freeze(id);
  }
}
