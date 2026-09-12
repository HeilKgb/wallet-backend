# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Estrutura inicial do projeto NestJS.

## [0.0.1] - 2026-09-12

### Adicionado

- Configuração inicial do projeto (NestJS, Jest, oxlint).

[Não lançado]: https://github.com/seu-usuario/wallet-back/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/seu-usuario/wallet-back/releases/tag/v0.0.1

## [0.0.2] 

### Adicionado
[Não lançado] Criação dos DTOs e configuração do banco de dados


## [0.0.3]
[Não lançado]
- Endpoints de usuários (`UsersModule`, `UsersController`, `UsersService`): cadastro e login local, com hash de senha via scrypt.
- Autenticação via JWT (`AuthModule`, `JwtAuthGuard`): rotas protegidas por padrão, com `@Public()` liberando cadastro, login e health check; token de acesso retornado no cadastro e login.
- Autorização por dono do recurso (`OwnResourceGuard`): `GET/PATCH/DELETE /users/:id` só permitem acesso se o `sub` do token corresponder ao `:id` da rota.
- Suporte a TLS/HTTPS em `main.ts` via variáveis `TLS_CERT_PATH` e `TLS_KEY_PATH`.
- Validação global de DTOs (`ValidationPipe` via `APP_PIPE`): payloads inválidos ou com campos não esperados são rejeitados com 400.
- Testes de integração de usuários (`test/users.e2e-spec.ts`): cadastro, criação da conta associada, login, autorização por dono do recurso, atualização e congelamento de conta, usando um Pool de Postgres fake em memória (`test/utils/fake-pg-pool.ts`).

