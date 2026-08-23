# Escritório — Sidebar de pessoas: ações, offline e recolher

**Data:** 2026-07-15
**Status:** design aprovado (aguardando review do spec)
**Depende de:** feature "Card de personagem" (já na `main`) — reusa `useOfficeInteractions`.

## Problema

A sidebar "pessoas online" do escritório hoje só lista quem está no mapa, sem
ações. Faltam três coisas: (1) as ações **chamar / seguir / ver perfil** — que
já existem no card ao clicar no personagem — acessíveis direto da lista, por um
menu de 3 pontinhos; (2) uma lista de **offline** (o resto do time) abaixo da
online, para saber quem existe mas não está presente; (3) uma **setinha** por
seção para recolher/expandir cada lista.

## Escopo do v1

**Dentro:** menu `⋮` por pessoa na lista online com chamar/seguir/ver perfil;
seção "Offline" abaixo da online (time todo menos quem está no mapa); chevron
de expandir/recolher em cada seção; extração da lista para um componente
próprio.

**Fora (deliberadamente):** busca funcional (o campo "Buscar pessoas" é um stub
do time — intocado); status/humor customizado; ordenação especial; ações para
offline além de "ver perfil"; persistir o estado aberto/recolhido entre sessões.

## Decisões de design

- **Reuso total das ações.** `useOfficeInteractions` (na `main`) já expõe
  `call(userId)`, `follow(userId)` e `viewProfile(userId)`. O menu só os chama —
  nenhuma lógica nova de chamada/follow. A `OfficePage` já instancia esse hook e
  passa as ações para a sidebar.
- **Offline = universo − presentes.** `GET /users` (autenticado) já devolve o
  time ativo **excluindo admins e você mesmo**, ordenado por nome. Offline = essa
  lista menos os `userId` que estão em `occupants`. Sem endpoint novo.
  - Consequência aceita: **você** nunca aparece na lista offline (o endpoint te
    exclui), e continua aparecendo na online com "(você)". Admins não aparecem
    em nenhuma (coerente: não entram no escritório).
- **Regras do menu por contexto.** Chamar e seguir só existem para outra pessoa
  **presente**. Então: linha online de outra pessoa → menu completo (chamar,
  seguir, ver perfil); **sua** linha online → só "ver perfil"; qualquer linha
  offline → só "ver perfil". (Mesma regra que o card no mapa aplica ao próprio
  usuário.)
- **Um menu aberto por vez**, fechando em clique-fora, `Esc` e após a ação —
  seguindo o padrão de dropdown ad-hoc do repo (`NotificationBell`: overlay
  `absolute`, `bg-surface-container`, `shadow-lg`; sem lib de menu).
- **Default das setinhas: online aberta, offline recolhida.** A lista offline é
  o time inteiro; abri-la por padrão encheria a sidebar. Estado local (não
  persiste).
- **Extração.** A `OfficePage` está grande e ganhando responsabilidades a cada
  iteração. A lista sai para `apps/web/src/office/PeopleList.tsx`, com uma
  fronteira limpa: recebe presença + callbacks, busca o time por conta própria.

## Arquitetura

### Componente `PeopleList` (`apps/web/src/office/PeopleList.tsx`)

Props:

```ts
interface PeopleListProps {
  occupants: OfficeOccupant[]
  youId: string | null
  onCall: (userId: string) => void
  onFollow: (userId: string) => void
  onViewProfile: (userId: string) => void
}
```

Responsabilidades:

- Busca o time com React Query: `queryKey ['users']`, `queryFn` →
  `apiFetch<{ users: PublicUser[] }>('/users')`. `staleTime` moderado (ex. 60s).
- Deriva:
  - **online** = `occupants` (a fonte da presença é o WS, não o REST);
  - **offline** = `users` cujo `id` não está no conjunto de `occupants` **e** não
    é `youId` (defensivo, embora o endpoint já exclua você).
- Renderiza duas seções (`PeopleSection`), cada uma com cabeçalho-botão
  (`Online (N)` / `Offline (N)`) com chevron e `aria-expanded`, e a `<ul>`.
- Cada linha (`PersonRow`): avatar de iniciais + bolinha de status (verde
  online / cinza offline), nome (com "(você)" na sua linha online), subtítulo
  ("Ativo" / "Offline"), e o botão `⋮` (`more_vert`) que abre o menu de ações.
- Estado local: `openMenuUserId: string | null` (menu aberto), e
  `{ online: boolean; offline: boolean }` (seções expandidas).

Os itens do menu por linha vêm de uma função pura testável:

```ts
function menuActionsFor(args: {
  userId: string
  isSelf: boolean
  isOnline: boolean
}): Array<'call' | 'follow' | 'view-profile'>
// self → ['view-profile']; online (outro) → ['call','follow','view-profile'];
// offline → ['view-profile']
```

### `OfficePage` (`apps/web/src/pages/OfficePage.tsx`)

O bloco `<aside>` que hoje monta a lista online inline é substituído por
`<PeopleList occupants={occupants} youId={youId} onCall={interactions.call}
onFollow={interactions.follow} onViewProfile={interactions.viewProfile} />`.
O cabeçalho da sidebar (título "Escritório", contador, botão recolher a sidebar
inteira, campo "Buscar pessoas" stub) **permanece na OfficePage** — só a parte
das listas migra. Nada mais muda na página.

## Fluxos

1. **Abrir menu numa pessoa online** → clica `⋮` → dropdown com Chamar / Seguir
   / Ver perfil → clica "Chamar" → `onCall(userId)` (o mesmo relay/popup já
   existente) → menu fecha.
2. **Seguir pela lista** → "Seguir" → `onFollow(userId)` → o personagem começa a
   caminhar (mecânica já existente) → menu fecha.
3. **Ver perfil** (qualquer contexto) → `onViewProfile(userId)` → nova aba.
4. **Recolher offline** → clica o cabeçalho "Offline (N)" → a `<ul>` some, o
   chevron gira; clicar de novo reabre.
5. **Alguém entra/sai do escritório** → `occupants` muda pelo WS → a pessoa
   migra entre as seções automaticamente (online é derivado de `occupants`).

## Erros e bordas

- **`GET /users` falha/carregando** → seção Offline expandida mostra a frase
  discreta "Ninguém offline" (mesma quando a lista está de fato vazia — não
  distinguimos "carregando/erro" de "vazio" no v1); a online segue funcionando
  (não depende do REST). Sem crash.
- **Pessoa some do mapa com o menu dela aberto** → o menu fecha (o
  `openMenuUserId` deixa de ter linha correspondente; um efeito o limpa).
- **Duas abas suas** → você aparece uma vez na online com "(você)"; presença já
  é de-duplicada pelo hub.
- **Time grande** → a lista offline pode ser longa; a sidebar já tem
  `overflow-y-auto`. Recolhida por padrão ameniza.

## Testes

- **`menuActionsFor`** (função pura): self → só view-profile; online outro →
  três ações; offline → só view-profile.
- **`PeopleList.test.tsx`** (Testing Library, `apiFetch` mockado):
  - online lista os occupants, com "(você)" na sua linha;
  - offline = users retornados menos os occupants (e menos você);
  - chevron de cada seção esconde/mostra a `<ul>` respectiva;
  - abrir `⋮` numa pessoa online e clicar "Chamar"/"Seguir"/"Ver perfil" chama o
    callback certo com o `userId` certo; menu fecha após a ação;
  - o menu da **sua** linha e o de uma linha **offline** só têm "Ver perfil"
    (sem chamar/seguir);
  - um menu aberto por vez (abrir outro fecha o anterior); Esc/clique-fora fecha.
- **`OfficePage.test.tsx`**: ajustar o teste existente que hoje checa a lista
  inline (`screen.getByText('Online')`) para o componente extraído, mantendo os
  mocks de socket/media/broadcast/interactions.

## Riscos

- **A sidebar da `main` foi mexida por várias iterações do time** (chat nearby,
  reações). O trabalho é cirúrgico: só troca o miolo das listas por `PeopleList`,
  preservando o cabeçalho/busca/recolher-sidebar exatamente como estão — para
  não conflitar com o que o time está tocando em paralelo.
- **`PublicUser` traz `photoUrl`/avatar**; o v1 mantém o visual de **iniciais**
  que o time adotou nas linhas online (não introduz avatar DiceBear aqui) para
  ficar consistente e evitar regressão visual.
