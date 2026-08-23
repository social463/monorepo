# Próximos Aniversariantes Specification

## Problem Statement

Na Home do Legends, os cards de "Aniversariantes do dia" (nascimento e tempo de casa) só mostram
quem faz aniversário **hoje**. Na maioria dos dias os dois cards ficam vazios (e desaparecem, já
que retornam `null` sem conteúdo), então o colaborador raramente vê algo ali — a informação só
aparece no dia exato, sem nenhum aviso do que vem por aí. Queremos virar isso: mostrar sempre os
**próximos aniversariantes**, para que o time saiba com antecedência quem comemorar e o card deixe
de ser um "acerte o dia certo".

## Goals

- [ ] Os dois cards da Home (nascimento e tempo de casa) sempre mostram os próximos aniversariantes
      a partir de hoje (inclusive hoje), não só quem faz aniversário exatamente hoje.
- [ ] Quem faz aniversário hoje continua visível, mas com destaque diferenciado ("Hoje").
- [ ] O próprio aniversário de nascimento do viewer, no dia, ganha uma comemoração visual (confete)
      ao entrar na Home — uma vez por dia, não a cada navegação/refresh.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Mudar a tela de Calendário (`/calendario`) | Ela já usa a visão de mês (`month`) do mesmo endpoint, não `today`; esta feature não altera esse fluxo. |
| Confete no aniversário de empresa (tempo de casa) | Decisão explícita do usuário: confete é só para aniversário de nascimento. |
| Notificação/push fora da Home (email, Slack/Teams) | Feature é só sobre o que aparece nos cards da Home. |
| Configurar quantas "datas" aparecem (hoje é fixo em 3) | Não pedido; se necessário, é uma feature futura de configuração. |

---

## User Stories

### P1: Ver os próximos aniversariantes de nascimento na Home ⭐ MVP

**User Story**: Como colaborador, quero ver na Home quem são os próximos aniversariantes de
nascimento (não só quem faz aniversário hoje), para poder me programar e cumprimentar o time.

**Why P1**: É o pedido central da feature — sem isso não há entrega.

**Acceptance Criteria**:

1. WHEN a Home carrega THEN o card "Próximos aniversariantes" (nascimento) SHALL exibir todas as
   pessoas cujo aniversário observado cai nas **3 datas mais próximas a partir de hoje (inclusive
   hoje)**, respeitando as mesmas regras de elegibilidade já existentes (colaborador ativo, não
   `ADMIN`/`SUBADMIN`, visibilidade cross-setor para `THIRD_PARTY`, viewer incluído) e com
   `birthDate` cadastrado.
2. WHEN uma pessoa da lista faz aniversário **hoje** THEN o item SHALL exibir o rótulo destacado
   "Hoje" (visualmente diferente dos demais).
3. WHEN uma pessoa da lista faz aniversário numa data futura THEN o item SHALL exibir "Amanhã"
   (D+1) ou "Em N dias" (D+2 em diante), junto da data absoluta no formato `dd/mm/aaaa`.
4. WHEN mais de uma das 3 datas mais próximas tem múltiplas pessoas THEN a lista SHALL mostrar
   **todas elas**, sem cortar em um número fixo de pessoas — o corte é por **data**, não por
   pessoa.
5. WHEN a lista de nomes é maior que o espaço visível do card THEN o card SHALL rolar internamente
   (scroll), sem estourar o layout da Home.
6. WHEN não há nenhum colaborador elegível com `birthDate` cadastrado (lista vazia) THEN o card
   SHALL se comportar como hoje quando não tem conteúdo (não renderiza nada — `null` —, mesma
   regra atual de "conteúdo acessório").
7. WHEN um aniversário observado cai em 29/02 THEN o cálculo da próxima ocorrência e o rótulo de
   data exibido SHALL seguir a regra já existente no serviço (comemorado em 28/02 em anos não
   bissextos).

**Independent Test**: Popular usuários de teste com `birthDate` em datas variadas (hoje, amanhã,
daqui a alguns dias, mesma data futura repetida em 4+ pessoas) e verificar que o card mostra a
lista certa, com os rótulos certos e scroll quando aplicável.

---

### P1: Ver os próximos aniversários de empresa (tempo de casa) na Home ⭐ MVP

**User Story**: Como colaborador, quero ver na Home quem são os próximos aniversários de empresa
(tempo de casa), para acompanhar quem está completando tempo na empresa em breve.

**Why P1**: Mesmo pedido do card de nascimento, espelhado para tempo de casa — ambos fazem parte
do mesmo escopo mínimo da feature.

**Acceptance Criteria**:

1. WHEN a Home carrega THEN o card "Próximos aniversariantes" (empresa) SHALL exibir todas as
   pessoas cujo próximo aniversário de empresa cai nas **3 datas mais próximas a partir de hoje
   (inclusive hoje)**, com as mesmas regras de elegibilidade e visibilidade do card de nascimento,
   calculadas sobre `joinedAt`.
2. WHEN a próxima ocorrência de alguém completaria **menos de 1 ano** de casa (ex.: contratado
   neste ano civil) THEN essa ocorrência SHALL ser ignorada e o cálculo SHALL considerar a
   ocorrência seguinte (que já bate 1 ano) — mesma regra que hoje exclui "0 anos".
3. WHEN uma pessoa da lista completa o aniversário de empresa **hoje** THEN o item SHALL exibir o
   rótulo destacado "Hoje"; nos demais casos, "Amanhã" ou "Em N dias" + data absoluta
   `dd/mm/aaaa`, igual ao card de nascimento.
4. WHEN mais de uma pessoa cai na mesma data dentre as 3 mais próximas THEN todas SHALL aparecer
   (mesma regra de "corte por data" do card de nascimento), com scroll interno se necessário.
5. WHEN não há nenhum colaborador elegível THEN o card SHALL se comportar como hoje quando vazio
   (`null`).
6. Cada item SHALL continuar mostrando a legenda de tempo de casa (`tenureLabel`, ex. "3 anos de
   casa"), calculada para os anos que a pessoa completa **naquela ocorrência futura**, não os anos
   atuais.

**Independent Test**: Popular usuários de teste com `joinedAt` variados (incluindo alguém
contratado neste ano civil, cuja próxima ocorrência deve pular para o ano que vem) e verificar a
lista, rótulos e `tenureLabel` exibidos.

---

### P2: Confete no aniversário de nascimento do próprio usuário

**User Story**: Como colaborador, no dia do meu aniversário de nascimento, quero uma comemoração
visual ao entrar na Home, para me sentir celebrado pela empresa.

**Why P2**: É um complemento de encantamento sobre o P1 — o produto funciona sem ele, mas foi
pedido explicitamente e é pequeno o suficiente para entrar no mesmo ciclo.

**Acceptance Criteria**:

1. WHEN o viewer entra na Home E hoje é o dia do aniversário de nascimento **dele** (observado,
   aplicando a regra de 29/02 quando for o caso) THEN a Home SHALL disparar uma animação de
   confete na tela.
2. WHEN o confete já foi exibido para aquele usuário **naquele dia civil** (America/Sao_Paulo, a
   mesma referência de "hoje" usada no resto do endpoint) THEN novos carregamentos/navegações de
   volta à Home no mesmo dia SHALL NOT disparar o confete de novo.
3. WHEN o dia civil muda THEN o confete SHALL poder disparar novamente, se aplicável.
4. WHEN hoje é o aniversário de **empresa** do viewer (não o de nascimento) THEN o confete SHALL
   NOT disparar — está fora do escopo desta história.
5. O controle de "já mostrado hoje" SHALL ser local ao navegador (não depende de estado no
   servidor) e SHALL falhar de forma silenciosa se o armazenamento local não estiver disponível
   (ex.: navegação privada) — nunca deve quebrar o carregamento da Home.

**Independent Test**: Mockar "hoje" como o aniversário de nascimento do viewer, montar a Home e
verificar que o confete dispara uma vez; simular uma segunda montagem no mesmo dia e verificar que
não dispara de novo; mudar o dia mockado e verificar que volta a disparar (se ainda for aniversário
naquele novo dia, no teste isso não se aplica — o teste real é: reset do dia permite novo disparo
quando a condição de aniversário for satisfeita nesse novo dia).

---

## Edge Cases

- WHEN um colaborador não tem `birthDate` cadastrado THEN ele SHALL ser ignorado no card de
  nascimento (e no gatilho de confete) — mesma regra já existente hoje.
- WHEN a empresa tem poucos colaboradores elegíveis (menos gente do que caberia em 3 datas) THEN o
  card SHALL mostrar quantas datas/pessoas existirem, sem tentar completar um número fixo.
- WHEN um aniversário cai em 29/02 e o ano corrente (ou o ano da próxima ocorrência) não é
  bissexto THEN a data observada SHALL ser 28/02, tanto no cálculo de "próxima data" quanto no
  rótulo exibido — reaproveitando a regra já testada em `celebration-service.ts`.
- WHEN o próprio viewer está entre os próximos aniversariantes THEN ele SHALL aparecer
  normalmente na lista (mesma regra atual de inclusão do viewer).
- WHEN o `localStorage` está bloqueado/indisponível (modo privado, política do navegador) THEN a
  feature de confete SHALL degradar silenciosamente (sem confete, sem erro visível) — mesmo
  espírito de "best-effort" já usado em outras features acessórias do repo (ex.: avaliação de
  selos pós-voto).
- WHEN a query de celebrações está carregando ou falha THEN os cards SHALL manter o comportamento
  atual de não renderizar nada (`null`) enquanto isso.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ANIV-01 | P1: Nascimento | Execute | Verified |
| ANIV-02 | P1: Nascimento | Execute | Verified |
| ANIV-03 | P1: Nascimento | Execute | Verified |
| ANIV-04 | P1: Nascimento | Execute | Verified |
| ANIV-05 | P1: Empresa | Execute | Verified |
| ANIV-06 | P1: Empresa | Execute | Verified |
| ANIV-07 | P1: Empresa | Execute | Verified |
| ANIV-08 | P2: Confete | Execute | Verified |
| ANIV-09 | Contrato API (`/celebrations`) | Execute | Verified |

**ID format:** `ANIV-NN`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 9 total, 9 mapeados e verificados — testes de service/rota (API), componente (Web) e
`getCelebrations` batido em Postgres real via HTTP (`GET /celebrations` com dados reais). Sem
verificação visual em navegador (sem ferramenta de screenshot disponível nesta sessão) — ver nota
final para o que falta conferir olhando a tela.

---

## Success Criteria

- [ ] Os dois cards da Home mostram, em qualquer dia, os próximos aniversariantes (nascimento e
      empresa), não só os de hoje.
- [ ] Um colaborador cujo aniversário de nascimento é hoje vê o confete ao abrir a Home, uma única
      vez naquele dia.
- [ ] Nenhum teste existente de `/celebrations` (calendário, `today`/`month`) quebra por causa da
      mudança — a tela de Calendário continua funcionando sem alteração de comportamento.
- [ ] `pnpm test` passa (API + Web) com a suíte nova cobrindo os cenários acima.
