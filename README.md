# Legends

Plataforma interna de reconhecimento entre pares da engenharia.

## Stack
- Monorepo: pnpm workspaces
- Backend: Fastify + Prisma + PostgreSQL (`apps/api`)
- Frontend: Vite + React + TypeScript + Tailwind (`apps/web`)
- Tipos compartilhados: `packages/shared`

## Pré-requisitos
- Node >= 20
- pnpm 9
- Docker (para o Postgres)

## Setup
```bash
pnpm install
docker compose up -d            # sobe o Postgres
pnpm db:migrate                 # aplica as migrations
pnpm db:seed                    # popula categorias, selos, usuários e período
```

## Rodar em desenvolvimento
```bash
pnpm dev                        # sobe api (3333) e web (5173) em paralelo
```

## Editor de mapas do escritório

Administradores encontram a aba **Mapas** em `/admin`. Nela é possível criar
mapas, abrir o editor full-screen, validar, publicar/ativar versões e configurar
status, capacidade, voz e acesso das salas. A migration instala uma versão
inicial da planta legada com tileset local, portanto o escritório continua
funcionando mesmo sem armazenamento externo.

Uploads de tilesets PNG/WebP usam `S3_BUCKET`, `S3_REGION` e
`S3_PUBLIC_BASE_URL` de `apps/api/.env`. Sem essa configuração o upload retorna
503, mas edição e publicação com o tileset legado permanecem disponíveis.

## Testes
```bash
pnpm test                       # roda os testes de todos os workspaces
```

## Usuários seed (senha: changeme123)
- admin@empresa.com (ADMIN)
- ana@empresa.com, bruno@empresa.com, carla@empresa.com, diego@empresa.com (DEV)
