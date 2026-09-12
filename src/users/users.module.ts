import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OwnResourceGuard } from '../auth/own-resource.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, OwnResourceGuard],
  exports: [UsersService],
})
export class UsersModule {}
