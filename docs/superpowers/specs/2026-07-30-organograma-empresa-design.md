# Organograma da empresa na página de Time

**Data:** 2026-07-30
**Status:** implementado
**Revisado em:** 2026-08-03 — a árvore deixou de ser `empresa → setor → squad` e
passou a ser a cadeia de comando por líder direto (`User.managerId`).

## Objetivo

Transformar `/time` em um organograma navegável da empresa inteira, mostrando
**quem responde a quem**. A URL e a feature técnica `time` permanecem
compatíveis; o nome visível é **Organograma**.

## Estrutura e regras

- A árvore é uma cadeia de comando pessoa → pessoa, de profundidade livre,
  montada a partir do **líder direto** (`User.managerId`). Setor e squad são
  rótulos no card, não níveis da hierarquia.
- O líder direto pode cruzar setor de propósito: uma coordenadora de Operações
  pode responder à head de Gente e Gestão.
- São exibidos usuários ativos `HEAD`, `MANAGER`, `LEAD` e `LEGEND` de setores
  ativos da empresa autenticada. Contas administrativas, super admin e
  terceirizados não aparecem.
- **Raiz** é quem não tem líder direto elegível — normalmente uma pessoa só, o
  topo da empresa. Se o líder de alguém sai da árvore (desligado, virou admin,
  setor desativado), quem respondia a ele sobe para a raiz em vez de sumir:
  ninguém entra no total sem aparecer na árvore.
- `managerId` é campo livre, então a leitura se defende de ciclo: o elo que
  fecha o laço é rompido e aquele nó vira raiz. A escrita já recusa ciclo,
  auto-liderança, líder inativo e líder de outra empresa.
- Cada nível é ordenado por tamanho de equipe (mais liderados primeiro) e depois
  por nome.
- O endpoint do organograma é próprio. `GET /users` permanece sectorizado e sem
  alterações porque também alimenta votação, escritório e outros fluxos.

## API e contrato

`GET /organization` exige autenticação e a feature `time`. A resposta é
`{ company, roots, totalPeople }`, onde cada nó traz identidade, cargo, papel,
setor, avatar, seus `reports` e `reportsCount` (subárvore, sem contar o próprio
nó). O DTO não expõe e-mail, webhook nem permissões.

O líder direto é editado em **Administração → Organização → Lendas**
(`/admin/lendas`), via `managerId`
em `POST /admin/users` e `PATCH /admin/users/:id`, com validação em
`assertManagerAssignable` e registro de auditoria. A coluna é
`User.managerId` com auto-relação e `ON DELETE SET NULL`.

`CompanyResponsible` e `Sector.responsibleId` continuam existindo e sendo
editáveis em **Administração → Setores**, mas **não alimentam mais o
organograma** — hoje só o líder direto desenha a árvore.

## Experiência

Árvore horizontal, aberta por padrão, lida de cima para baixo, com conectores
completos: barra horizontal ligando os irmãos e um traço descendo em cada um.
Cada card é compacto e vertical — avatar sobreposto no topo, nome, cargo e setor
em maiúscula — e traz no avatar um badge com o número de liderados diretos, que
recolhe/expande aquela equipe; recolhido, o badge mostra `+N` da subárvore
inteira. Quando todos os filhos de um nó são folhas, eles quebram em grade, para
um time grande não empurrar a árvore para a direita.

A busca casa nome, cargo, setor e papel, e **mantém a linha de comando acima de
quem casou** — sem os líderes, o resultado apareceria solto e não daria para
situar a pessoa.

A árvore vive em um canvas único, sem barras de rolagem internas: move-se
arrastando o fundo (mouse ou toque) e recebe zoom de 60% a 140% pela roda do
mouse ou pelos controles. Busca, expandir/recolher tudo, zoom e o CTA de
reconhecimento ficam numa barra flutuante dentro do canvas, que preenche todo o
espaço abaixo do cabeçalho. Cards abrem o perfil; o CTA de reconhecimento
continua só para contas não administrativas.

Enquanto ninguém tiver líder direto cadastrado, todo mundo é raiz e a tela diz
isso explicitamente, apontando o admin para **Administração → Organização →
Lendas** — uma fileira única sem explicação passaria por bug.

## Fora de escopo

- Squad principal, ou squad como nível da árvore.
- Alterar a semântica de `/users`, a URL `/time` ou a feature `time`.
