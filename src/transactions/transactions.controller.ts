import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateReversalRequestDto,
  CreateTransferDto,
  TransactionResponseDto,
} from './dto/transitions.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  createTransfer(@Req() request: Request, @Body() dto: CreateTransferDto): Promise<TransactionResponseDto> {
    return this.transactionsService.createTransfer(request.user!.sub, dto);
  }

  @Get()
  findAll(): Promise<TransactionResponseDto[]> {
    return this.transactionsService.findAll();
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<TransactionResponseDto> {
    return this.transactionsService.findById(id);
  }

  @Post('reversals')
  reverse(@Req() request: Request, @Body() dto: CreateReversalRequestDto): Promise<TransactionResponseDto> {
    return this.transactionsService.reverse(request.user!.sub, dto);
  }
}