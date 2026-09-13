import { IsDecimal, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { TransactionStatus } from '../../common/enums/transaction-status.enum';
import { Exclude, Expose } from 'class-transformer';


export class CreateTransferDto {
  // Exatamente um dos dois identificadores de destino deve ser informado (validado no service).
  @ValidateIf((dto: CreateTransferDto) => !dto.destinationCpf)
  @IsString()
  @Matches(/^\d+$/, { message: 'número da conta deve conter apenas dígitos' })
  destinationAccountNumber?: string;

  @ValidateIf((dto: CreateTransferDto) => !dto.destinationAccountNumber)
  @IsString()
  @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos' })
  destinationCpf?: string;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false }, { message: 'valor deve ter no máximo 2 casas decimais' })
  @Matches(/^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/, {
    message: 'valor deve ser maior que zero',
  })
  amount: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /**
   * Gerada pelo client (ex: uuid v4) e enviada em toda tentativa de transferência,
   * inclusive em retries. O backend usa esse valor como UNIQUE em transactions.idempotency_key
   * pra garantir que um retry de rede nunca gere uma transferência duplicada.
   */
  @IsUUID('4', { message: 'idempotencyKey deve ser um UUID v4' })
  idempotencyKey: string;

  /** Senha de acesso do usuário autenticado, exigida para confirmar a transferência. */
  @IsString()
  @MinLength(1, { message: 'senha é obrigatória' })
  password: string;
}


@Exclude()
export class TransactionResponseDto {
  @Expose() id: string;
  @Expose() type: TransactionType;
  @Expose() status: TransactionStatus;
  @Expose() amount: string;
  @Expose() currency: string;
  @Expose() description: string | null;
  @Expose() originAccountId: string | null;
  @Expose() destinationAccountId: string | null;
  @Expose() reversalOfId: string | null;
  @Expose() createdAt: Date;
  @Expose() completedAt: Date | null;
}

export class CreateReversalRequestDto {
  @IsUUID('4', { message: 'transactionId deve ser um UUID válido' })
  transactionId: string;

  @IsString({ message: 'caso deseje, descreva o motivo da reversão com mais detalhes.' })
  reason?: string;
}

export class ReviewReversalRequestDto {
  @IsIn(['APPROVED', 'REJECTED'], { message: 'status deve ser APPROVED ou REJECTED' })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reviewNote?: string;
}
