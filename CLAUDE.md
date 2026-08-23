# CLAUDE.md

Contexto e convenções deste repo vivem em **`AGENTS.md`** (fonte única, compartilhada
com Codex e demais agentes). Leia-o primeiro:

@AGENTS.md

## Específico do Claude Code

- **Sub-agentes para explorar:** use o agente `Explore` para mapear/buscar antes de
  editar; trabalhe a partir de fatos do código, não de suposições.
- **Antes de concluir uma mudança:** rode `pnpm test` (suba o Postgres com `pnpm db:up`
  primeiro — os testes da API batem em banco real, ver `AGENTS.md`).
- **Escopo:** rotas finas, lógica em service, DTO em `serialize.ts`, contrato em
  `@legends/shared`. Não misture camadas.
- **Migrations:** gere com `pnpm db:migrate`; nunca edite uma migration já aplicada.
- **Mensagens ao usuário** em português; siga o estilo da camada vizinha.
