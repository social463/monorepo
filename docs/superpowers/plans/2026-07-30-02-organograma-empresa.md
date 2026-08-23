# Organograma da empresa — Implementation Plan

**Goal:** Reformular `/time` como organograma interativo da empresa inteira sem
alterar os consumidores atuais de `GET /users`.

## 1. Contrato e backend

- Criar DTOs do organograma em `@legends/shared` e exportá-los pelo barril.
- Criar um serviço que carrega setores, pessoas e squads ativos, isolados por
  `companyId`, e monta liderança, squads e pessoas sem squad.
- Expor `GET /organization` com autenticação e `requireFeature('time')`.
- Persistir responsáveis opcionais em empresa e setor, expor sua configuração
  administrativa com validação tenant/estado ativo e registrar auditoria.
- Cobrir isolamento multiempresa, papéis permitidos, inativos, multi-squad,
  deduplicação do líder/responsável, sem squad, ordenação e dados sensíveis.

## 2. Frontend

- Substituir a grade de `TeamPage` pela árvore responsiva, aberta inicialmente e
  organizada horizontalmente no desktop, com líderes acima dos liderados,
  busca, expansão e um canvas arrastável com zoom pela roda do mouse, links de
  perfil e CTA de reconhecimento.
- Colocar busca e controles numa barra flutuante dentro do canvas e fazer o
  viewport preencher toda a área restante abaixo do cabeçalho.
- Permitir a escolha de múltiplos responsáveis da empresa e de um responsável
  por setor na seção administrativa de Setores, exibindo-os acima das
  respectivas ramificações.
- Criar um skeleton fiel ao organograma e estados de erro/vazio.
- Renomear o item de navegação para Organograma mantendo `/time` e `time`.

## 3. Verificação

- Testar o endpoint e a `TeamPage` de forma focada.
- Atualizar testes de navegação/roteamento afetados.
- Rodar `pnpm test` e `pnpm build` antes da conclusão.
