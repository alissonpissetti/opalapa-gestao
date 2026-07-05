# Opalapa — Gestão

Sistema de gestão para o evento Opalapa. Começa pelo módulo de **espaços comerciais**: mapa interativo, controle de status, vendas em grupo e relatórios.

Os dados são persistidos em **MariaDB/MySQL** remoto.

## Funcionalidades

- Mapa interativo com 16 espaços numerados
- Status: disponível, em negociação, reservado, vendido/fechado
- Seleção múltipla para vendas em grupo
- Relatório com filtros e totais negociados
- Exportação CSV e impressão
- Sincronização automática com banco de dados

## Configuração

Copie o arquivo de ambiente e ajuste a URL do banco:

```bash
cp .env.example .env
```

Variáveis:

| Variável         | Descrição                          |
|------------------|------------------------------------|
| `DATABASE_URL`   | URL MySQL/MariaDB                  |
| `PORT`           | Porta da API (padrão: 3000)        |
| `SESSION_SECRET` | Chave para assinar tokens de sessão |

Exemplo:

```
DATABASE_URL=mysql://usuario:senha@host:5433/default
PORT=3001
SESSION_SECRET=chave-longa-e-aleatoria
```

Na primeira execução, o servidor cria as tabelas `grupos_espacos`, `espacos`, `tipos_comercio` e `users`. Os espaços são organizados em **agrupamentos** (ex.: Feira Comercial 1, Feira Comercial 2, Praça de Alimentação, Expositores 5×5). Todos os dados são lidos e gravados exclusivamente no banco.

## Autenticação

Usuários ficam na tabela `users` do banco:

| Coluna          | Descrição                              |
|-----------------|----------------------------------------|
| `name`          | Nome do usuário                        |
| `email`         | E-mail (login alternativo, único)      |
| `phone`         | Celular só dígitos (login alternativo) |
| `password_hash` | Senha com hash bcrypt                  |

Pelo menos **e-mail ou celular** é obrigatório por usuário. O login aceita qualquer um dos dois + senha. A sessão fica em cookie httpOnly por 7 dias.

### Criar usuários

```bash
npm run user:create -- --name "Administrador" --email admin@opalapa.com --password "sua-senha"
npm run user:create -- --name "Maria" --phone 11999998888 --password "sua-senha"
npm run user:create -- --name "João" --email joao@opalapa.com --phone 11988887777 --password "sua-senha"
```

Endpoints públicos: `/api/health`, `/api/auth/login`  
Demais rotas exigem sessão válida.

## Desenvolvimento

```bash
npm install
npm run dev
```

**Importante:** use sempre `npm run dev` — ele sobe API e frontend juntos. Se rodar só `vite` ou `npm run dev:web`, as chamadas `/api/*` falham com `ECONNREFUSED`.

- Frontend: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health) (porta definida em `PORT` no `.env`)

O Vite faz proxy de `/api` para a API local.

### Banco de dados em desenvolvimento

O projeto usa **MariaDB remoto** (não há `docker-compose` nem banco local no repositório). O `.env` deve apontar para um servidor acessível da sua rede.

Se `npm run dev` falhar com `ETIMEDOUT` ou `ECONNREFUSED` na inicialização:

1. Confirme `DATABASE_URL` no `.env` (host, porta `5433`, usuário e senha).
2. Teste a conectividade: `npm run db:test`
3. Verifique internet, VPN (se exigida pelo provedor) e firewall bloqueando a porta do banco.

## Produção (local)

```bash
npm run build
npm start
```

O servidor Express serve a API e os arquivos estáticos de `dist/` na mesma porta.

## Deploy no Coolify (Hostinger)

O deploy automático usa **GitHub Actions** + **Coolify**: a cada `git push` na branch `main`, o workflow valida o `Dockerfile` e dispara o deploy no Coolify.

### 1. Configuração no Coolify

1. Crie um **Resource** → **Application** → conecte o repositório `alissonpissetti/opalapa-gestao`
2. Branch: `main`
3. Tipo de build: **Dockerfile** (caminho: `Dockerfile` na raiz)
4. Porta do container: `3000` (ou variável `PORT`)
5. Health check: `GET /api/health` na porta `3000`
6. Em **General**, ative **Auto Deploy** (opcional — o GitHub Actions também dispara o deploy)
7. Em **Webhooks**, copie a **Deploy Webhook URL**

### 2. Secrets no GitHub

Em [Settings → Secrets and variables → Actions](https://github.com/alissonpissetti/opalapa-gestao/settings/secrets/actions):

| Secret             | Onde obter                                                                 |
|--------------------|----------------------------------------------------------------------------|
| `COOLIFY_WEBHOOK`  | Coolify → Application → Webhooks → Deploy Webhook URL                      |
| `COOLIFY_TOKEN`    | Coolify → Keys & Tokens → API token com permissão **deploy** (recomendado) |

Sem o `COOLIFY_WEBHOOK`, o workflow **falha** e o deploy não é disparado. O `COOLIFY_TOKEN` é obrigatório se o Coolify usar o endpoint `/api/v1/deploy` (recomendado).

**Configuração rápida:**

1. Coolify → sua aplicação → **Webhooks** → copie a URL (formato `https://.../api/v1/deploy?uuid=...`)
2. Coolify → **Keys & Tokens** → crie API token com permissão **Deploy**
3. GitHub → [Secrets do repositório](https://github.com/alissonpissetti/opalapa-gestao/settings/secrets/actions) → crie `COOLIFY_WEBHOOK` e `COOLIFY_TOKEN`
4. Faça um push em `main` ou rode o workflow manualmente em **Actions → Deploy → Run workflow**

Alternativa: no Coolify, ative **Auto Deploy** com a integração GitHub (GitHub App) — aí cada push dispara o build direto no Coolify, sem depender do webhook do Actions.

### 3. Variáveis de ambiente no Coolify (obrigatórias)

| Variável         | Exemplo                                      |
|------------------|----------------------------------------------|
| `DATABASE_URL`   | `mysql://user:pass@host:5433/default`        |
| `SESSION_SECRET` | chave longa e aleatória                      |
| `NODE_ENV`       | `production` (já definido no Dockerfile)     |

Opcional: `PORT`, `APP_PUBLIC_URL`, variáveis Evolution/WhatsApp/Nextcloud (ver `.env.example`).

Após o deploy, crie o primeiro usuário com `npm run user:create` (localmente apontando para o mesmo banco) ou via terminal do Coolify.

### Fluxo CI/CD

```
git push (main)
  → GitHub Actions: docker build (validação)
  → GitHub Actions: curl webhook Coolify
  → Coolify: docker build + deploy
  → GET /api/health
```

O banco MariaDB/MySQL deve estar acessível a partir do servidor Coolify (rede/firewall).

### Deploy manual

No GitHub: **Actions** → **Deploy** → **Run workflow**.

No Coolify: botão **Deploy** na aplicação.

## Estrutura

```
server/         API Express + MariaDB
src/
  css/          estilos globais
  data/         polígonos do mapa
  lib/          store, API client, formatação
  modules/      módulos da aplicação
public/
  map.png       imagem do mapa
```

## API

| Método | Rota              | Descrição              |
|--------|-------------------|------------------------|
| GET    | `/api/health`     | Status da conexão      |
| POST   | `/api/auth/login` | Login (e-mail ou celular + senha) |
| GET    | `/api/auth/me`    | Sessão atual           |
| POST   | `/api/auth/logout`| Encerrar sessão        |
| GET    | `/api/users`      | Lista usuários         |
| POST   | `/api/users`      | Cria usuário           |
| PUT    | `/api/users/:id`  | Atualiza usuário       |
| DELETE | `/api/users/:id`  | Exclui usuário         |
| GET    | `/api/grupos`                    | Lista agrupamentos de espaços |
| GET    | `/api/grupos/:slug/espacos`      | Espaços de um agrupamento     |
| PUT    | `/api/grupos/:slug/espacos`      | Salva alterações              |
| GET    | `/api/tipos-comercio`            | Lista tipos de comércio       |

Body do `PUT`:

```json
{
  "updates": [
    { "id": 1, "status": "vend", "tipo": "Alimentação", "client": "Empresa X", "valor": 1500, "obs": "", "saleGroup": "", "updatedAt": "2026-06-10T12:00:00.000Z" }
  ]
}
```
# opalapa-gestao
