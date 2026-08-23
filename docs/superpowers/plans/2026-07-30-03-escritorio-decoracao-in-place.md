# Plano de execução — salvar decoração in-place

**Data:** 2026-07-30
**Spec:** `docs/superpowers/specs/2026-07-30-escritorio-decoracao-in-place-design.md`
**Card:** 22041

## Entregas

1. Schema: `decorRevision` em `OfficeMapPublication` e a model
   `OfficeMapDecorRevision`, com migration nova e registro em `tenant-scope`.
2. Contrato em `@legends/shared`: `decorRevision` no `ActiveOfficeMapDTO`, os
   tipos do save de decoração e os limites do anel e da poda.
3. Save de decoração grava in-place com guarda otimista, empurra o documento
   anterior no anel e refaz o ciclo quando outra edição entra no meio.
4. Reconciliar salas e mesas por `externalKey` em vez de recriá-las, para a
   claim de mesa e a configuração de sala sobreviverem ao save.
5. Podar publicações no publish estrutural, preservando sempre a ativa.
6. Editor web ancorado em `decorRevision`, indo e voltando pelo save.
7. Verificação final: build, typecheck e a suíte completa.

## Aceite

- Salvar decoração não cria publicação e avança apenas a revisão.
- O anel retém as dez últimas revisões e serve de base ao merge de 3 vias;
  editor mais antigo que isso cai no fallback sem erro.
- Quem está sentado numa mesa continua sentado depois de alguém salvar.
- Sala criada pela decoração aparece, sala removida some, e a que permanece
  mantém status, capacidade e concessões de acesso.
- Um mapa nunca passa de dez publicações, e a ativa nunca é apagada.
- Kart movido no editor reconcilia mesmo sem troca de publicação.
