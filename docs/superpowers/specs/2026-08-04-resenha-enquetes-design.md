# Resenha — Enquetes com resultado após o voto — Design Spec

- **Data:** 2026-08-04
- **Status:** aprovado para implementação

## Objetivo

Adicionar **Enquete** às opções do compositor da Resenha, ao lado de GIF e imagem.
Quem ainda não votou vê somente a pergunta e as opções; depois de votar, passa a
ver a distribuição atual (contagem e percentual) e qual opção escolheu.

## Decisões

- A enquete pertence a uma resenha e tem uma pergunta de 1–140 caracteres e de
  2 a 10 opções, cada uma com 1–80 caracteres.
- Opções repetidas após `trim` e comparação sem diferenciar maiúsculas/minúsculas
  são rejeitadas.
- Enquete, GIF e imagem são anexos mutuamente exclusivos.
- O texto comum da resenha é opcional quando existe enquete; ele pode ser usado
  como contexto acima dela.
- Cada usuário vota uma única vez. O voto não pode ser alterado ou removido nesta
  primeira versão.
- A enquete não expira nesta primeira versão; fica aberta enquanto a resenha existir.
- O autor não recebe acesso antecipado ao resultado: como qualquer pessoa, precisa
  votar para vê-lo.
- O resultado é protegido pela API: antes do voto, `totalVotes`, `voteCount` e
  `percentage` são `null`, em vez de o frontend apenas esconder números recebidos.
- Depois de votar, a pessoa pode abrir **Ver votos** para consultar os votantes
  agrupados pela opção escolhida. A lista nominal é buscada sob demanda e a API
  recusa a consulta de quem ainda não votou.
- O voto respeita o isolamento atual da Resenha por empresa e setor. Um id de
  resenha/opção de outro escopo responde como não encontrado.

## Contrato compartilhado

`ReviewDTO` ganha `poll: ReviewPollDTO | null`; `CreateReviewRequest` aceita
`poll?: { question: string; options: string[] }`.

```ts
interface ReviewPollOptionDTO {
  id: string
  text: string
  voteCount: number | null
  percentage: number | null
}

interface ReviewPollDTO {
  id: string
  question: string
  hasVoted: boolean
  selectedOptionId: string | null
  totalVotes: number | null
  options: ReviewPollOptionDTO[]
}
```

O endpoint `POST /reviews/:id/poll/vote` recebe `{ optionId }` e devolve a
`ReviewDTO` atualizada. Um segundo voto responde `409`.

`GET /reviews/:id/poll/votes` devolve as opções com seus respectivos votantes
somente quando o usuário autenticado já votou; antes disso responde `403`.

## Persistência

- `ReviewPoll`: relação 1:1 com `Review`, pergunta e escopo de empresa/setor.
- `ReviewPollOption`: texto e posição estável dentro da enquete.
- `ReviewPollVote`: opção escolhida e usuário; `@@unique([pollId, userId])`
  garante um voto por pessoa.
- Exclusão da resenha cascateia para enquete, opções e votos.

Todos os três models entram em `TENANT_SCOPED_MODELS` e recebem `companyId` e
`sectorId`, seguindo as regras atuais da família `Review`.

## Interface

- Botão **Enquete** fica na barra de anexos do `ReviewComposer`, junto de GIF e
  imagem.
- Ao ativar, aparecem pergunta, duas opções iniciais, ação para adicionar opção
  e remoção das opções extras. O compositor impede publicação enquanto a enquete
  estiver inválida.
- Antes do voto, o card renderiza opções selecionáveis e botão **Votar** sem
  qualquer contagem.
- Depois do voto, cada opção vira uma barra de progresso com percentual e votos;
  a escolha do usuário fica marcada.
- O botão **Ver votos** expande a lista de nomes e avatares agrupada por opção.
- Falha ao votar mantém a enquete no estado anterior e exibe mensagem em português.

## Testes essenciais

- Service: criação/validação, um voto por usuário, opção de outra enquete, escopo
  por empresa/setor e resultados ocultos/visíveis na serialização.
- Route: payload de criação, voto bem-sucedido e segundo voto `409`.
- Web: compositor cria/remove opções e envia o payload; card não mostra resultado
  antes do voto, envia a opção selecionada e mostra percentuais depois do voto.

## Fora de escopo

- Prazo/encerramento manual, múltipla escolha, anonimato configurável, troca de
  voto e enquete em comentários ou no mural corporativo.
