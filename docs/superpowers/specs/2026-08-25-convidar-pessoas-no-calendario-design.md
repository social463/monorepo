# Convite a pessoas específicas no calendário — design

**Origem:** `Ajustes_Portal_EMR_Documento_3.md`, seção 11.

> Incluir, no cadastro de evento, a opção de **convidar pessoas específicas pelo
> nome**, além da segmentação por tags de público-alvo já existente. A pessoa
> convidada deve ser **notificada do evento** (sininho e, se estiver ativa na
> plataforma, pop-up, seguindo o mesmo padrão dos comunicados).

É o último item do documento que depende só de nós — o 8 (Agente de
Benchmarking) espera material da G&G. Ele ficou de fora do fatiamento original
em lotes; este spec fecha a lacuna.

## Como o evento alcança gente hoje

Duas regras que se **somam**, e nenhuma delas fala de pessoa:

- **Setor** (`CalendarEventSector`): sem setor cadastrado, o evento é da empresa
  inteira; com setor, só quem está nele (`visibilityWhere`).
- **Tag de público-alvo** (`audienceTags`): "Todos", o nome do setor, "G&G",
  "Líder", "CEO" — derivadas da pessoa por `viewerAudienceTags`, nunca guardadas.

Quem quer chamar três pessoas de setores diferentes não tem como: teria de abrir
o evento para os três setores inteiros.

## O que entra

### Modelo

```prisma
model CalendarEventGuest {
  eventId, userId, companyId
  @@unique([eventId, userId])
}
```

Tabela própria, e não um `String[]` de ids no evento: convidado é **relação com
gente**, e um array de texto não tem FK — pessoa excluída deixaria id órfão, e
não haveria como perguntar "em que eventos fulano foi convidado" sem varrer a
tabela inteira. `onDelete: Cascade` no evento e na pessoa.

### Visibilidade

O convidado vê o evento **independentemente de setor e de tag**. É o ponto todo
do convite nominal: chamar alguém que o recorte por setor não alcançaria.

Isso é um OR nos dois níveis — no `where` do Prisma (junto de `visibilityWhere`)
e no filtro em memória de `audienceReaches`. Mexer só num dos dois deixaria o
convidado de fora sem erro nenhum aparecer.

O que **não** afrouxa: **Ação de Comunicação Interna** continua invisível para
quem não é do bloco de G&G, convidado ou não. Esse filtro existe para o registro
interno da área não vazar, e um convite não é autorização para vê-lo — se a G&G
quiser chamar alguém para um evento desses, o caminho é desmarcar a flag.

### Notificação

Tipo novo `CALENDAR_EVENT_INVITED`, com o mesmo `createNotification` de todo o
resto — sininho, contador e, quando a empresa tem Teams ligado, o card.

**Só os convidados novos são avisados.** Na edição, quem já estava na lista não
recebe de novo: salvar o evento para corrigir uma vírgula na descrição não pode
disparar um aviso para todo mundo. O diff é feito no service, comparando a lista
que chega com a que está no banco.

### Pop-up

O documento pede "o mesmo padrão dos comunicados". O padrão do comunicado é um
**hub WebSocket global** mais um toast que busca o post e trata 404 como "não é
para você" — desenho que existe porque o feed precisa aparecer no mesmo segundo.

Aqui o mecanismo é outro, e de propósito: o toast sai da **consulta de
notificações que já roda a cada 10 segundos**. Motivos:

1. O convite é **por pessoa**, e notificação já é por pessoa. O hub do mural é
   canal único e global: replicá-lo faria toda conexão da empresa buscar o evento
   a cada convite, para a maioria descobrir que não é dela.
2. Dez segundos são invisíveis num convite de agenda — ao contrário do feed, em
   que o comunicado "acabou de sair" é a experiência.
3. Não custa hub novo, rota nova nem segunda conexão por aba.

O toast é o mesmo componente visual do comunicado, montado no `AppLayout`, e
mostra **só** `CALENDAR_EVENT_INVITED` — nenhum outro tipo de notificação vira
pop-up, senão cada feedback recebido viraria um.

### Lembrete

O convidado entra na lista de quem recebe o lembrete de antecedência
(`CALENDAR_EVENT_REMINDER`). Sem isso ele receberia o convite e nunca o
lembrete — o agendador hoje monta os destinatários **por setor**, e o convidado
de fora do setor cairia fora.

Nota do que **não** vou consertar: esse agendador ignora `audienceTags`
completamente. Um evento marcado "Líder" lembra o setor inteiro. É defeito
anterior a este item e de outro escopo; fica registrado nas pendências.

### Tela

Campo **Convidados** no formulário de evento, com busca por nome na base de
colaboradores e seleção múltipla — reusando o `TargetPicker` do Mural de
Feedbacks, que já faz busca com `excludeIds`. Convive com o campo de público-alvo
por tag, como a OBS do documento pede: um evento pode ter os dois preenchidos, e
eles se somam.

O DTO do evento passa a carregar os convidados **só para quem administra** — a
lista de nomes é da gestão do evento, não do calendário de quem olha.

## Permissões

Exatamente a tabela da seção 11, sem afrouxar nada:

| Perfil | Pode | Não pode |
|---|---|---|
| Colaborador | Ver e ser notificado do evento em que foi convidado | Criar, editar, excluir; convidar |
| Líder | O mesmo do Colaborador | O mesmo |
| Admin / G&G | Criar evento, definir público por tag e **convidar pelo nome** | — |

Quem convida é quem já podia cadastrar evento (`canEditCalendarEvent`): ADMIN
pleno, SUBADMIN do setor com `desenvolvimento-produto` e a liderança.

## Pendências

1. **O lembrete ignora `audienceTags`** — defeito anterior. Evento marcado
   "Líder" lembra o setor inteiro.
2. **Convite não pede confirmação.** O documento não pede RSVP, e o 1:1 já tem
   mecanismo próprio (`OneOnOneInvite`, com aceite e contraproposta). Se a G&G
   quiser presença confirmada no calendário, é feature à parte.
