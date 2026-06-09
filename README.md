# SetupBot para Discord

Bot profissional para configurar servidores Discord de venda de produtos digitais.

## Funcionalidades

- `/ativar` cria cargos, categorias, canais e paineis automaticamente.
- Sistema de verificacao, compra, renovacao, tickets e sugestoes.
- Boas-vindas, saidas, auto-moderacao, vencimento de clientes e relatorios.
- Comandos essenciais para ativar o servidor e publicar paineis.
- Pagamento Pix pelo PagBank no fluxo de contrato e fila.

## Estrutura

```text
src/
  commands/      Comandos slash do Discord.
  config/        Configuracao de cargos, canais e cores.
  lib/           Regras de negocio e componentes reutilizaveis.
  payments/      Servidor Express, MongoDB de pedidos, PagBank e comprovantes.
  services/      Servicos em segundo plano.
  index.js       Entrada principal do bot.
scripts/
  check-syntax.js        Verifica a sintaxe de todos os arquivos JS.
  discord/               Scripts operacionais de deploy, sync e publicacao.
data/                    Dados locais gerados em desenvolvimento.
```

## Instalar

Requer Node.js `>=20.19.0`.

```bash
npm install
```

Copie `.env.example` para `.env` e preencha:

```bash
DISCORD_TOKEN=token_do_bot
CLIENT_ID=id_da_aplicacao
# Opcional: usado apenas por scripts de um servidor especifico.
GUILD_ID=
MONGODB_URI=sua_uri_mongodb
MONGODB_DB_NAME=orvitek
PAGBANK_ENV=sandbox
PAGBANK_TOKEN=token_pagbank
```

Os pedidos e pagamentos ficam salvos no MongoDB, na coleção `pedidos` por padrão. Os demais dados do bot usam a coleção `bot_store`. Para trocar os nomes, ajuste `MONGODB_DB_NAME`, `MONGODB_ORDERS_COLLECTION` e `MONGODB_STORE_COLLECTION`.

Para usar pagamento real, configure `PAGBANK_ENV=production` e use o token de produção da conta PagBank. O bot gera o Pix após o contrato e a chave de acesso, e o cliente usa o botão **Verificar PagBank** para confirmar o pagamento.

## Registrar comandos

```bash
npm run deploy
```

O deploy registra os comandos globalmente, entao o `/ativar` fica disponivel em todos os servidores onde o bot estiver instalado. Se voce tiver comandos locais antigos em algum servidor, preencha `GUILD_ID` ou `GUILD_COMMAND_CLEAR_IDS=id1,id2` antes do deploy para limpa-los.

No `/ativar`, informe o ID do servidor de origem/modelo, o ID do servidor destino onde cargos/canais/paineis serao criados e o ID Discord do dono/responsavel que recebera o cargo Dono no destino. O bot copia cargos nao gerenciados, categorias e canais basicos da origem para o destino antes de publicar os paineis do sistema.

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

## Integracao com Orvitek Hospedagem

Este bot precisa enviar informacoes para o bot Orvitek-hospedagem. Mantenha `ORVITEK_HOSTING_BOT_ENABLED=true` no `.env` e configure o endpoint correto do Orvitek-hospedagem.

Quando essa integracao esta ativa e a hospedagem de um cliente passa do prazo de tolerancia, o bot chama `deleteHostingAccess`, grava uma ordem no MongoDB e tambem pode enviar um `POST` para o outro bot de hospedagem antes de limpar a chave local do cliente. Configure no `.env`:

```bash
ORVITEK_HOSTING_BOT_ENABLED=true
MONGODB_HOSTING_EVENTS_COLLECTION=hosting_shutdown_events
HOSTING_API_URL=https://hospedagem.seudominio.com
ORVITEK_HOSTING_BOT_URL=https://hospedagem.seudominio.com/api/orvitek/desligar
ORVITEK_HOSTING_BOT_RESTORE_URL=https://hospedagem.seudominio.com/api/orvitek/religar
ORVITEK_HOSTING_BOT_TOKEN=um_token_compartilhado_entre_os_bots
ORVITEK_HOSTING_BOT_TIMEOUT_MS=10000
ORVITEK_HOSTING_BOT_DEBUG=false
```

O painel `renovar-plano` pede a chave de acesso do cliente. Depois que a chave e validada, o bot abre um ticket privado, identifica o projeto, envia o metodo de pagamento configurado no painel e aguarda confirmacao. Ao confirmar o pagamento por PagBank ou pelo botao manual **Confirmar pagamento**, o bot marca a hospedagem como paga, devolve o acesso ao canal do projeto, reativa os cargos do cliente e envia um evento `hosting.payment_confirmed.restore` para o bot de hospedagem.

Para o plano FiveM FAC, quando o pagamento/ativacao for aprovado, o bot gera um codigo numerico de 4 digitos e envia por DM ao cliente. Esse codigo e enviado ao bot de hospedagem via `POST ${HOSTING_API_URL}/api/orvitek/fivem-fac-token`; se a API responder conflito, outro codigo e gerado automaticamente. O cliente deve usar `/ativar` no bot hospedado dele para liberar o `/painel-fac`.

O painel de planos tambem possui o **Plano Mensal**, com hospedagem inclusa no valor mensal e suporte ao cupom ativo antes da assinatura do contrato. Ele abre ticket na categoria `plano mensal - mensal`; quando uma categoria chega a 10 canais, o bot cria a proxima automaticamente. O fluxo mensal envia contrato, libera o pagamento mensal com o desconto do cupom quando aplicado e so gera o codigo de liberacao depois que o cliente cadastra a chave/senha no canal dele.

Se quiser separar os paineis por canal, configure no `.env`:

```bash
MONTHLY_PLAN_CHANNEL_ID=id_do_canal_plano_mensal
LIFETIME_PLAN_CHANNEL_ID=id_do_canal_plano_vitalicio
```

Depois publique com o script de planos. O bot agora trabalha com dois paineis separados: o canal mensal recebe somente o **Plano Mensal** com hospedagem inclusa, e o canal vitalicio recebe somente o **Plano Vitalicio**. Nesse caso o bot e vitalicio, mas a hospedagem continua mensal quando contratada.

Se esses IDs ficarem vazios, o setup usa `planos-e-precos` como painel mensal e `comprar-agora` como painel vitalicio.

No banco, o bot grava/upserta um documento na colecao `hosting_shutdown_events` com `status: "pending"`, `eventId`, `payload`, `createdAt` e `updatedAt`. O outro bot pode buscar por `status: "pending"`, desligar ou religar usando `payload.hosting.accessKey` e `payload.action.type`, depois atualizar para `status: "processed"` com `processedAt`.

Para liberar cadastro de bots hospedados, o bot tambem grava/upserta na colecao `hosting_registration_permissions`. O outro bot deve permitir o cadastro somente quando encontrar `allowed: true` e `status: "paid"` para a mesma `accessKey`. Se nao encontrar, ou se `allowed` for `false`, deve bloquear o formulario e mostrar pagamento nao confirmado.

Para ver no console se os dois bots estao conversando, coloque `ORVITEK_HOSTING_BOT_DEBUG=true` no `.env`. O console vai mostrar quando a permissao de cadastro for gravada, quando uma ordem de desligamento for registrada no MongoDB, quando o POST for enviado ao outro bot e qual status HTTP voltou.

Se voce tambem usar HTTP, o outro bot deve aceitar `Authorization: Bearer <ORVITEK_HOSTING_BOT_TOKEN>` e receber um JSON com `event`, `guild`, `client`, `hosting` e `action`. O campo principal para desligar a hospedagem e `hosting.accessKey`; tambem sao enviados `client.userId`, `client.userTag`, `hosting.projectName`, `hosting.dueAt`, `hosting.graceUntil` e `action.reason`.

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

- `/ativar servidor_origem:<id_servidor_modelo> servidor_destino:<id_servidor_destino> id_discord:<id_do_dono_ou_responsavel>`
- `/clear`
- `/clean quantidade:<1-100> [usuario] [canal] [motivo]`
- `/produto`
- `/pedido`
- `/cliente`
- `/painel-verificar`
- `/painel`
- `Adm` escrito em um canal: atalho de emergencia para liberar os cargos de acesso ao dono configurado.

## Permissoes

Pode administrar quem tiver o cargo `ADMIN_ROLE_ID` configurado no `.env` ou a permissao **Gerenciar Servidor**.
O atalho `Adm` so funciona para `OWNER_USER_ID`, dono do servidor ou quem ja tiver o cargo `OWNER_ROLE_ID`/`Dono`.

## Limpeza segura de mensagens

Use `/clean` para apagar mensagens recentes em canais do servidor. O comando usa somente o token oficial do bot via `discord.js`, exige **Gerenciar mensagens** do usuario e do bot, mostra um painel de confirmacao e nunca tenta apagar DMs pessoais, amizades ou conversas privadas.

Configure no `.env` quando quiser ajustar limites ou logs:

```bash
CLEAN_MAX_MESSAGES=100
CLEAN_SCAN_LIMIT=200
CLEAN_CONFIRM_TTL_MS=300000
CLEAN_LOG_CHANNEL_ID=
CLEAN_SKIP_PINNED=true
```

Se `usuario` for informado, o bot mostra o Discord ID do usuario no painel e apaga somente mensagens desse ID dentro do canal escolhido, respeitando o limite de 14 dias do `bulkDelete`.
