# SetupBot para Discord

Bot profissional para configurar servidores Discord de venda de produtos digitais.

## Funcionalidades

- `/ativar` cria cargos, categorias, canais e paineis automaticamente.
- Sistema de verificacao, compra, renovacao, tickets e sugestoes.
- Boas-vindas, saidas, auto-moderacao, vencimento de clientes e relatorios.
- Comandos essenciais para ativar o servidor e publicar paineis.
- Pagamento Pix pelo PagBank no fluxo de contrato e fila.

## Instalar

```bash
npm install
```

Copie `.env.example` para `.env` e preencha:

```bash
DISCORD_TOKEN=token_do_bot
CLIENT_ID=id_da_aplicacao
GUILD_ID=id_do_servidor
PAGBANK_ENV=sandbox
PAGBANK_TOKEN=token_pagbank
```

Para usar pagamento real, configure `PAGBANK_ENV=production` e use o token de produção da conta PagBank. O bot gera o Pix após o contrato e a chave de acesso, e o cliente usa o botão **Verificar PagBank** para confirmar o pagamento.

## Registrar comandos

```bash
npm run deploy
```

## Iniciar bot

```bash
npm start
```

## Iniciar servidor de pagamentos

```bash
npm run payments
```

O `npm run payments` sobe o Express em `PORT` com:

- `POST /pagamento/criar`
- `POST /webhook/pagbank`
- `GET /pagamento/:id/status`
- `GET /pagamentos`
- `POST /api/auth/panel/issue`
- `POST /dashboard/verificacao`
- `GET /dashboard/acesso/:guildId/:userId`

As rotas da dashboard exigem `BOT_DASHBOARD_TOKEN` no header `X-Dashboard-Token` ou `Authorization: Bearer <token>`.
Para o login no painel Orvitek, configure `DASHBOARD_URL` e `BOT_DASHBOARD_TOKEN`. O usuario usa `/verificar site` no Discord; o bot chama `POST ${DASHBOARD_URL}/api/auth/panel/issue` e responde com o codigo de 4 digitos retornado pela dashboard.

## Testar webhook com ngrok

```bash
ngrok http 3000
```

Use a URL HTTPS gerada no `.env`:

```bash
WEBHOOK_URL=https://sua-url-ngrok.ngrok-free.app/webhook/pagbank
```

## Produção PagBank

Para trocar sandbox por produção, altere:

```bash
PAGBANK_URL=https://api.pagseguro.com
```

## Gmail App Password

Conta Google -> Segurança -> Verificação em duas etapas -> Senhas de app. Use a senha gerada em `GMAIL_APP_PASSWORD`.

## Discord DM

Crie o bot em `discord.com/developers` -> New Application -> Bot -> Reset Token. Use em `DISCORD_BOT_TOKEN`.

Para obter o Discord User ID: Discord -> Configurações -> Avançado -> Ativar Modo Desenvolvedor -> clique com botão direito no usuário -> Copiar ID.

## Comandos principais

- `/ativar`
- `/clear`
- `/painel-verificar`
- `/verificar site`
- `/painel`

## Permissoes

Pode administrar quem tiver o cargo `ADMIN_ROLE_ID` configurado no `.env` ou a permissao **Gerenciar Servidor**.
