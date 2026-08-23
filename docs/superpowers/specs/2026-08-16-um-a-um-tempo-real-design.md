# 1:1 — tempo real durante a conversa

## Problema

O 1:1 é a única tela do produto em que **as duas pessoas estão nela ao mesmo
tempo**, cada uma no seu computador, enquanto conversam. E é a única em que isso
não funciona: hoje a tela só relê o encontro quando quem está olhando faz alguma
coisa. Um combina uma ação, o outro não vê; um marca o tópico como discutido, o
outro continua olhando a caixa desmarcada; um adiciona uma ação ao plano de PDI, o
outro precisa dar F5 para o bloco "Plano de X" mudar.

Na prática, a conversa vira ditado: uma pessoa anota e a outra pergunta "já
apareceu aí?". Pior no combinado, que é o artefato que sobrevive à reunião — se as
duas anotam por não terem certeza de que a outra anotou, o par termina com a mesma
ação duplicada.

Falta também **editar um combinado já registrado**. A API sempre aceitou
(`PATCH /one-on-ones/actions/:id` com `description`/`ownerId`), mas a tela só
oferecia concluir ou promover ao PDI. Errar o texto ou o responsável — que é o
erro mais comum, porque se digita durante a conversa — não tinha conserto pela
interface.

## Entrega

A tela do encontro (`/1-1/:id`) e a agenda (`/1-1`) se atualizam sozinhas quando a
outra pessoa mexe: tópico criado, editado, removido ou marcado; combinado criado,
editado, concluído ou promovido; encontro remarcado, cancelado, respondido ou
marcado como realizado; e o bloco de PDI do par, mesmo quando a escrita veio da
tela `/pdi`.

E o combinado passa a ser editável: descrição e responsável, no lugar da linha,
como já se faz com o tópico da pauta.

## Decisões

### O canal é por PESSOA, não por sala

Retro tem sala por `roomId`; resenha e mural têm um canal global. Nenhum dos dois
serve aqui:

- **Sala por encontro não fecha.** Um combinado em aberto pertence ao **par**, não
  ao encontro em que nasceu — ele aparece em todo 1:1 entre as duas pessoas
  (`openActions` no detalhe). Concluir um combinado muda a tela de vários
  encontros, inclusive de outra série. E a agenda `/1-1` não tem encontro nenhum
  em mãos para entrar numa sala.
- **Canal global não fecha.** 1:1 é conversa fechada entre dois. Mesmo um evento
  magro ("mudou alguma coisa") entregue à empresa inteira já é informação sobre
  uma conversa privada.

Então `OneOnOneHub` indexa conexões por `userId`, e cada escrita escolhe
explicitamente os destinatários. Vazamento não depende de o cliente filtrar
direito: o servidor nunca envia a quem não é do par.

### Eventos magros, sempre

Quatro eventos, nenhum com conteúdo:

| Evento | Quando | O cliente invalida |
|---|---|---|
| `agenda:changed` | série criada, remarcada, cancelada, respondida, realizada | `['one-on-ones']` + `['one-on-one']` |
| `meeting:changed` (+ `meetingId`) | pauta de um encontro | `['one-on-one', id]` + `['one-on-ones']` |
| `actions:changed` | combinados do par | `['one-on-one']` + `['one-on-ones']` |
| `pdi:changed` | plano ou ação de PDI do par | `['pdi']` + `['one-on-one']` |

O refetch é que traz o estado, e ele carrega o recorte de **quem está olhando**.
É isso que mantém a promessa de privacidade da feature sem código novo: a nota
privada de um participante nunca é empurrada, porque nenhum evento carrega texto.
Salvar a nota, aliás, **não emite evento nenhum** — nem o aviso de que ela existe.

`actions:changed` e `pdi:changed` não carregam id de encontro porque, no canal por
pessoa, o destinatário já é uma das duas: invalidar os detalhes em cache pelo
prefixo `['one-on-one']` é sempre correto e custa quase nada.

### O broadcast mora no service

Divergência deliberada de retro/resenha, que emitem da rota. Lá o hub é indexado
por um id que a rota já tem; aqui o destinatário é o **par**, que é justamente o
que a rota não tem — ela recebe um id de tópico ou de ação. Descobrir o par na
rota custaria uma consulta a mais em toda escrita, enquanto o service já carrega a
série em todas elas (e já é de lá que saem as notificações do 1:1).

O `emit` é síncrono e sem `await`: o hub é memória local, e nada nele pode atrasar
ou derrubar uma escrita já confirmada.

### O PDI também empurra

`pdi-service` chama o `oneOnOneHub` — o único acoplamento novo entre os dois
módulos, e ele existe porque o bloco "Plano de X" é lido dentro do 1:1. Os
destinatários são dono e líder do plano. Trocar o líder avisa também o líder
**anterior**: o bloco sumir da tela dele é uma mudança tão real quanto aparecer.

Quem não tem 1:1 aberto simplesmente não está conectado, e o evento morre sem
destinatário — não há custo em emitir.

## Limites conhecidos

- **Uma instância.** O hub é memória local, como o do retro e o da resenha. Com
  mais de um pod, quem estiver na outra instância não recebe (Redis fica como
  futuro, junto com os outros hubs).
- **A tela `/pdi` não assina o canal.** Ela invalida por conta própria a cada
  escrita; o evento existe para a tela do 1:1. Assinar lá é um passo separado.
- **Prazo do combinado continua sem interface.** A API aceita `dueDate` em criar e
  editar, mas nenhuma das duas telas o oferece — a edição não inventou um campo
  que a criação não tem.
