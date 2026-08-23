# Chat por perto: conter texto longo no balão — PRD / Implementation Plan

> **For agentic workers:** use `tlc-spec-driven` to execute this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o overflow visual de mensagens longas enviadas pelo Chat por
perto, garantindo que fala/pensamento fiquem contidos no balão do personagem.

**Spec:** `docs/superpowers/specs/2026-07-31-chat-por-perto-texto-longo-design.md`

**Task:** 22059

**Architecture:** mudança concentrada no frontend. O envio nasce em
`MediaBar.tsx`, passa pelo `OfficeBridge` como `nearby-message`, e o render final
é feito no Phaser por `OfficeScene.showNearbyBubble`. A correção deve preferir
normalização/limite no ponto de render, com limite opcional na UI se isso
melhorar feedback e contrato local.

## Global Constraints

- Não implementar nesta etapa de documentação.
- Mensagens ao usuário em português.
- Não alterar comportamento de `room-chat-message`/`RoomChatPanel`.
- Não alterar comportamento de reações rápidas, high-five ou grade de câmeras.
- Evitar número mágico duplicado para limite de texto/largura de balão.
- Testes focados durante implementação; suíte completa só na verificação final,
  se o escopo crescer.
- Antes de codar, comparar o estado atual com `origin/fix/chat-input-focus-grid`
  e com o PR ativo `10689`, para reduzir conflito no escritório.

---

### Task 1: Confirmar reprodução e ponto de falha

**Files:**
- Read: `apps/web/src/office/media/MediaBar.tsx`
- Read: `apps/web/src/office/scenes/OfficeScene.ts`
- Read: `apps/web/src/office/scenes/OfficeScene.test.ts`
- Read: `apps/web/src/office/media/MediaBar.test.tsx`

- [ ] Reproduzir mentalmente o fluxo: `MediaBar.sendNearbyMessage` →
  `onNearbyMessage` → `OfficeBridge` → `OfficeScene.showNearbyBubble`.
- [ ] Confirmar se o overflow acontece por palavra/token sem espaço, por limite
  alto de caracteres ou por altura do fundo calculada depois do wrap.
- [ ] Comparar `origin/fix/chat-input-focus-grid` apenas para identificar se há
  mudança concorrente no input/hotkey/chat.
- [ ] Registrar no PR final o cenário exato que foi corrigido.

### Task 2: Definir limite e quebra do texto do balão

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

- [x] Criar constantes nomeadas para limite de caracteres e largura máxima do
  texto/fundo do balão, se ainda não existirem.
- [x] Implementar estratégia para tokens longos caberem no balão:
  quebra defensiva de tokens antes do `this.add.text`, ou configuração avançada
  de wrap do Phaser validada em teste.
- [x] Manter truncamento defensivo para payload remoto.
- [x] Garantir que largura do fundo continue limitada, independentemente de
  `label.width`.
- [x] Manter fala e pensamento usando o mesmo caminho de contenção, salvo
  diferença visual já existente de cor/cauda.

### Task 3: Decidir se a UI deve limitar entrada

**Files:**
- Optional Modify: `apps/web/src/office/media/MediaBar.tsx`
- Optional Test: `apps/web/src/office/media/MediaBar.test.tsx`

- [x] Se o render já resolver o bug com defesa suficiente, deixar o input sem
  novo `maxLength`.
- [ ] Se houver `maxLength`, alinhar o limite com a defesa do render e testar o
  texto enviado.
- [x] Preservar envio vazio fechando o chat.
- [x] Preservar envio válido limpando input e mantendo o chat aberto.

### Task 4: Testes automatizados

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.test.ts`
- Optional Modify: `apps/web/src/office/media/MediaBar.test.tsx`

- [x] Adicionar teste para palavra única longa no balão de fala.
- [x] Adicionar teste para URL/sequência sem espaços, se a implementação tiver
  normalizador próprio.
- [x] Adicionar teste para modo pensamento se compartilhar helper ou estilo
  diferente.
- [x] Preservar teste existente de reação/emoji sem fundo.
- [x] Rodar:

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts src/office/media/MediaBar.test.tsx
```

### Task 5: Validação visual focada

- [ ] Subir o web em dev se a correção visual não for óbvia por teste unitário.
- [ ] Enviar uma palavra longa pelo Chat por perto e verificar no canvas.
- [ ] Repetir em modo `Pensar`.
- [ ] Repetir com reação rápida para garantir que o comportamento não mudou.
- [ ] Validar em viewport estreito, porque o quadrante visual do mapa tem menos
  folga.

## Definition of Done

- Texto longo enviado pelo Chat por perto fica visualmente contido.
- Payload remoto excessivo não cria balão maior que o limite esperado.
- Teste unitário cobre palavra sem espaço.
- Reações rápidas e chat da sala permanecem sem alteração.
- PR referencia a task `22059`, o spec e este plano.
