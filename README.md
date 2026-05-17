# SetupBot para Discord

Bot profissional para configurar servidores Discord de venda de produtos digitais.

## Funcionalidades

- `/ativar` cria cargos, categorias, canais e paineis automaticamente.
- Sistema de verificacao, compra, renovacao, tickets e sugestoes.
- Boas-vindas, saidas, auto-moderacao, vencimento de clientes e relatorios.
- Comandos essenciais para ativar o servidor e publicar paineis.

## Instalar

```bash
npm install
```

Copie `.env.example` para `.env` e preencha:

```bash
DISCORD_TOKEN=token_do_bot
CLIENT_ID=id_da_aplicacao
GUILD_ID=id_do_servidor
```

## Registrar comandos

```bash
npm run deploy
```

## Iniciar

```bash
npm start
```

## Comandos principais

- `/ativar`
- `/clear`
- `/painel-verificar`
- `/painel`

## Permissoes

Pode administrar quem tiver o cargo `ADMIN_ROLE_ID` configurado no `.env` ou a permissao **Gerenciar Servidor**.
