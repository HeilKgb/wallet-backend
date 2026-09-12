import { Exclude, Expose } from 'class-transformer';
import { AccountStatus } from './common/enums/account-status.enum';

@Exclude()
export class AccountResponseDto {
  @Expose() id: string;
  @Expose() accountNumber: string;
  @Expose() currency: string;
  @Expose() balance: string; 
  @Expose() status: AccountStatus;
  @Expose() createdAt: Date;
}
