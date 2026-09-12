import { jest } from '@jest/globals';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { LoginDto, LoginSocialDto, RegisterLocalDto, RegisterSocialDto, UpdateUserDto, UserResponseDto } from './dto/login.dto';

const userResponse: UserResponseDto = {
  id: '8f5d5c9e-5d22-4f3f-8f90-7e2d5cf4a123',
  fullName: 'Maria Silva',
  email: 'maria@example.com',
  cpf: '12345678901',
  phoneNumber: '5511999999999',
  authProvider: 'LOCAL' as UserResponseDto['authProvider'],
  status: 'ACTIVE' as UserResponseDto['status'],
  createdAt: new Date('2026-09-12T00:00:00.000Z'),
};

describe('UsersController', () => {
  let usersController: UsersController;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(() => {
    usersService = {
      registerLocal: jest.fn(),
      registerSocial: jest.fn(),
      login: jest.fn(),
      loginSocial: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      freeze: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    usersController = new UsersController(usersService);
  });

  it('deve registrar um usuário local', async () => {
    const dto = { fullName: 'Maria Silva', email: 'maria@example.com' } as RegisterLocalDto;
    usersService.registerLocal.mockResolvedValue(userResponse);

    await expect(usersController.register(dto)).resolves.toBe(userResponse);
    expect(usersService.registerLocal).toHaveBeenCalledWith(dto);
  });

  it('deve registrar um usuário social', async () => {
    const dto = { idToken: 'firebase-token', fullName: 'Maria Silva' } as RegisterSocialDto;
    usersService.registerSocial.mockResolvedValue(userResponse);

    await expect(usersController.registerSocial(dto)).resolves.toBe(userResponse);
    expect(usersService.registerSocial).toHaveBeenCalledWith(dto);
  });

  it('deve realizar login local', async () => {
    const dto = { email: 'maria@example.com', password: 'senha123' } as LoginDto;
    usersService.login.mockResolvedValue(userResponse);

    await expect(usersController.login(dto)).resolves.toBe(userResponse);
    expect(usersService.login).toHaveBeenCalledWith(dto);
  });

  it('deve realizar login social', async () => {
    const dto = { idToken: 'firebase-token' } as LoginSocialDto;
    usersService.loginSocial.mockResolvedValue(userResponse);

    await expect(usersController.loginSocial(dto)).resolves.toBe(userResponse);
    expect(usersService.loginSocial).toHaveBeenCalledWith(dto);
  });

  it('deve buscar um usuário pelo id', async () => {
    const userId = userResponse.id;
    usersService.findById.mockResolvedValue(userResponse);

    await expect(usersController.findOne(userId)).resolves.toBe(userResponse);
    expect(usersService.findById).toHaveBeenCalledWith(userId);
  });

  it('deve atualizar os dados de um usuário', async () => {
    const userId = userResponse.id;
    const dto = { email: 'novo-email@example.com', phoneNumber: '5511888888888' } as UpdateUserDto;
    usersService.update.mockResolvedValue(userResponse);

    await expect(usersController.update(userId, dto)).resolves.toBe(userResponse);
    expect(usersService.update).toHaveBeenCalledWith(userId, dto);
  });

  it('deve congelar um usuário sem excluí-lo', async () => {
    const userId = userResponse.id;
    usersService.freeze.mockResolvedValue({ ...userResponse, status: 'BLOCKED' as UserResponseDto['status'] });

    await expect(usersController.freeze(userId)).resolves.toEqual({ ...userResponse, status: 'BLOCKED' });
    expect(usersService.freeze).toHaveBeenCalledWith(userId);
  });
});
