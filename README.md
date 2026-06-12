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

## Produção (local)

```bash
npm run build
npm start
```

O servidor Express serve a API e os arquivos estáticos de `dist/` na mesma porta.

## Deploy no Coolify (Hostinger)

O repositório inclui um `Dockerfile` pronto para o Coolify fazer build e deploy a cada `git push`.

### Configuração no Coolify

1. Crie um novo **Resource** → **Application** → conecte este repositório Git
2. Tipo de build: **Dockerfile** (caminho: `Dockerfile` na raiz)
3. Porta do container: use a variável `PORT` (padrão `3000`)
4. Health check: `GET /api/health`

### Variáveis de ambiente (obrigatórias)

| Variável         | Exemplo                                      |
|------------------|----------------------------------------------|
| `DATABASE_URL`   | `mysql://user:pass@host:5433/default`        |
| `SESSION_SECRET` | chave longa e aleatória                      |
| `NODE_ENV`       | `production` (já definido no Dockerfile)     |

Opcional: `PORT`.

Após o deploy, crie o primeiro usuário com `npm run user:create` (localmente apontando para o mesmo banco) ou via terminal do Coolify.

### Fluxo CI/CD

```
git push → Coolify detecta → docker build → deploy → /api/health
```

O banco MariaDB/MySQL deve estar acessível a partir do servidor Coolify (rede/firewall).

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
