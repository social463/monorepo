# Enquete no Feed Corporativo — Design Spec

- **Data:** 2026-09-08
- **Status:** aprovado para implementação

## Objetivo

Levar a enquete que já existe na Resenha para o Feed Corporativo, com o
**comportamento de enquete da Resenha** e as **regras de postagem do Feed**.

A enquete da Resenha (`2026-08-04-resenha-enquetes-design.md`) listou como fora
de escopo, na época, "enquete em comentários ou no mural corporativo". Esta spec
resolve a segunda metade.

## O que se copia da Resenha, e por quê

O valor da enquete de lá não está na UI, está em **onde o resultado é escondido**:
antes de votar, `totalVotes`, `voteCount` e `percentage` chegam ao cliente como
`null` — a API não manda número que a pessoa não pode ver, em vez de mandar e
pedir para o front esconder. Isso é copiado ao pé da letra.

Também se copiam: um voto por pessoa (garantido por unique, com o `P2002` tratado
como o mesmo 409 do caminho feliz), voto que não se troca nem se remove, enquete
sem prazo, autor sem acesso antecipado ao resultado, e "Ver votos" liberado só
para quem já votou.

## O que muda por causa do Feed

O Feed não é a Resenha em três pontos que importam.

**Isolamento.** `CorporatePost` tem só `companyId` — não tem `sectorId`, e isso é
deliberado no schema. As checagens de escopo da Resenha comparam setor; aqui não
há setor a comparar. O recorte vem do **alcance do post**.

**Estado.** A resenha nasce publicada. O post do Feed tem quatro estados
(`PENDING`, `SCHEDULED`, `PUBLISHED`, `REJECTED`), e só o publicado aceita voto.
Votar num post que ainda pode ser recusado seria computar opinião sobre algo que
talvez nunca exista.

**Anexos.** A Resenha aceita um anexo só, e enquete disputa a vaga com GIF e
imagem. O Feed aceita até cinco anexos mais um GIF. A enquete **não disputa
vaga**: "banner + enquete" é o formato normal de comunicação interna — mostrar as
três propostas de logo e perguntar qual. Seguir a exclusividade da Resenha aqui
proibiria justamente o caso de uso.

## Decisões

- **Model próprio**, não um `kind` novo em `CorporatePostAttachment`. Aquela
  tabela é de arquivo enviado: deriva o `kind` do `contentType`, valida tamanho e
  exige URL do bucket. Enquete não tem URL, nem content-type, nem tamanho —
  entraria como linha de nulos e obrigaria `mediaKindFor` a nunca devolver
  `POLL`. Três models novos, no molde de `ReviewPoll`: `CorporatePostPoll` (1:1
  com o post), `CorporatePostPollOption` (`@@unique([pollId, position])`) e
  `CorporatePostPollVote` (`@@unique([pollId, userId])`).
- **Só `companyId`**, acompanhando o `CorporatePost`. Os três entram em
  `TENANT_SCOPED_MODELS`.
- **Quem vota é quem está no público-alvo** — e não quem enxerga o post. A
  diferença aparece no ADMIN e no SUBADMIN, que hoje enxergam qualquer post
  ignorando o alcance para poder moderar. Moderar não é participar: numa enquete
  dirigida a um setor, o voto de quem está fora dele suja o resultado. O admin
  continua vendo a enquete e o resultado; só não vota. É a mesma linha que
  `canSignBirthdayWall` já traçou ao não reaproveitar `canWriteFeedbackTo`.
- **Só post `PUBLISHED` aceita voto.** Nos demais estados a rota responde 409 com
  mensagem própria, e não 404: o post existe e a pessoa pode vê-lo; o que não
  existe ainda é a votação.
- **A enquete é editável enquanto ninguém votou, e congela no primeiro voto.**
  A janela de conserto real é a de post aguardando aprovação ou agendado, quando
  ainda não há voto. Trocar pergunta ou opção depois do primeiro voto tornaria o
  resultado mentiroso — e é justamente o que a edição livre do texto do post
  permitiria se a enquete seguisse a mesma regra dele.
- **Sem notificação nova.** O Feed já anuncia post publicado
  (`announceCorporatePostPublished`); um segundo aviso pela enquete notificaria
  duas vezes o mesmo fato. A Resenha tem `REVIEW_POLL_PUBLISHED` porque lá o post
  comum não notifica ninguém.
- **Sem evento de WebSocket novo.** O voto reusa `post:changed`, como reação e
  edição já fazem. O hub do mural é canal único e global, e o contrato manda o
  evento ser magro — só o id.

## Contrato compartilhado

Em `packages/shared/src/corporate-mural.ts`, espelhando `review.ts`:

```ts
export const CORPORATE_POST_POLL_QUESTION_MAX_LENGTH = 140
export const CORPORATE_POST_POLL_OPTION_MAX_LENGTH = 80
export const CORPORATE_POST_POLL_MIN_OPTIONS = 2
export const CORPORATE_POST_POLL_MAX_OPTIONS = 10

interface CorporatePostPollOptionDTO {
  id: string
  text: string
  voteCount: number | null   // null até o viewer votar
  percentage: number | null  // null até o viewer votar
}

interface CorporatePostPollDTO {
  id: string
  question: string
  hasVoted: boolean
  selectedOptionId: string | null
  totalVotes: number | null
  /** Falso para quem está fora do público-alvo (admin moderando, por exemplo). */
  canVote: boolean
  options: CorporatePostPollOptionDTO[]
}
```

`CorporatePostDTO` ganha `poll: CorporatePostPollDTO | null`;
`CreateCorporatePostRequest` ganha `poll?: { question: string; options: string[] }`.

`canVote` existe porque o front precisa distinguir "ainda não votei" de "não é
para mim votar" — sem ele, o admin veria um botão Votar que a API recusa.

## Rotas

- `POST /corporate-posts/:id/poll/vote` — `{ optionId }`, devolve o post
  atualizado. 409 em voto repetido, 409 em post não publicado, 403 para quem está
  fora do público-alvo, 404 para opção de outra enquete.
- `GET /corporate-posts/:id/poll/votes` — votantes agrupados por opção; 403 para
  quem ainda não votou.

## Interface

- Botão **Enquete** no `CorporatePostComposer`, ao lado de Foto/Vídeo/Documento/
  GIF — sem desabilitar os outros.
- `CorporatePostPollCard` dentro do `CorporatePostCard`, no molde do
  `ReviewPollCard`: opções selecionáveis e botão Votar antes; barras com
  percentual, contagem e a escolha marcada depois; "Ver votos" sob demanda.
- Quem não pode votar vê a enquete e o resultado, com a razão no lugar do botão.
- A aba de aprovação (`CorporateFeedApprovalTab`) mostra a enquete do post
  pendente, para o revisor saber o que está aprovando.

## Testes essenciais

- Service: validação de pergunta/opções, um voto por pessoa, opção de outra
  enquete, voto em post pendente/agendado, voto de quem está fora do alcance,
  resultado oculto antes do voto, enquete congelada após o primeiro voto.
- Rota: criação com enquete junto de anexo, voto, segundo voto 409, ver votos
  antes de votar 403.
- Web: compositor monta e envia a enquete sem excluir anexo; card esconde
  resultado antes do voto e mostra depois; sem botão Votar para quem não pode.

## Fora de escopo

Prazo e encerramento manual, múltipla escolha, troca de voto, enquete em
comentário e enquete no compositor de campanha.
