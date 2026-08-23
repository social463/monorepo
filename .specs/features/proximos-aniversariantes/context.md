# Próximos Aniversariantes Context

**Gathered:** 2026-08-08
**Spec:** `.specs/features/proximos-aniversariantes/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Os dois cards de aniversariantes da Home (nascimento e tempo de casa) passam a mostrar sempre os
**próximos** aniversariantes (não só os de hoje), agrupados pelas **3 datas mais próximas**, sem
cortar pessoas dentro de uma data — e o aniversário de nascimento do próprio viewer, no dia, ganha
confete na Home (uma vez por dia).

---

## Implementation Decisions

### Definição de "próximos 3"

- Não é "as 3 próximas pessoas": é **as 3 próximas datas distintas** a partir de hoje (hoje
  contando como a 1ª data possível).
- Todas as pessoas que caem em cada uma dessas 3 datas aparecem — se uma data tiver 5 pessoas,
  aparecem as 5. O card não teria mais uma quantidade fixa de itens.
- Overflow de altura é resolvido com **scroll interno no card**, não com truncamento ("+N") como o
  card atual faz.

### Hoje continua aparecendo, mas destacado

- Decisão inicial do usuário foi excluir "hoje" da lista de próximos; foi revisada depois: **hoje
  entra normalmente** como a data mais próxima possível (distância 0), mas com um rótulo/estilo
  visualmente destacado ("Hoje"), diferente do rótulo dos demais itens ("Amanhã" / "Em N dias").

### Rótulo de data

- Cada item mostra **as duas informações**: rótulo relativo ("Hoje", "Amanhã", "Em N dias") **e**
  a data absoluta no formato `dd/mm/aaaa`.

### Confete

- Dispara **só** para aniversário de **nascimento** do próprio viewer — não para aniversário de
  empresa (tempo de casa).
- Dispara **apenas a primeira vez** que a Home carrega naquele dia civil — não a cada
  navegação/refresh. Reset natural quando o dia muda.
- É aceitável (e esperado) que o controle de "já mostrado hoje" seja local ao navegador, sem
  depender de estado no servidor — o requisito original foi "se possível", ou seja, é uma
  comemoração best-effort, não crítica.

### Agent's Discretion

- Mecanismo exato de persistência do "já mostrado hoje" (ex.: `localStorage` com chave por
  usuário+data) fica a critério da implementação, desde que degrade silenciosamente se
  indisponível.
- Biblioteca/técnica de renderização do confete (ex.: pequena lib de canvas confetti vs. CSS) fica
  a critério da implementação — critério de escolha: leve, sem novas dependências pesadas, sem
  travar a Home se falhar.
- Estilo visual exato do destaque "Hoje" (cor, badge, borda) fica a critério do design de
  implementação, seguindo o design system do produto (branding tokens, não hex cru).

---

## Specific References

Nenhuma referência externa de produto foi citada. O pedido partiu do comportamento atual dos cards
(`BirthdaysCard`/`WorkAnniversariesCard`) e da vontade de trocar "hoje" por "próximos".

---

## Deferred Ideas

- Configurar quantas datas aparecem (hoje fixo em 3) — não pedido, ficaria para uma feature futura
  se algum dia for necessário.
- Confete também no aniversário de empresa — explicitamente descartado pelo usuário, não só
  adiado.
- Notificação fora da Home (email, Teams/Slack) sobre próximos aniversariantes — não mencionado,
  fora do escopo desta feature.
