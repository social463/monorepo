# Cronômetro e música ambiente na retro — design

Data: 2026-08-04
PBI: #22336 — "Melhorias sessão de retrospective"
PRD: `docs/superpowers/specs/2026-08-04-retro-cronometro-musica-prd.md`

## Contexto

A retrospectiva do Legends já usa WebSocket para eventos da sala e possui um hub
em memória por `roomId`. O novo cronômetro deve seguir o mesmo princípio: o banco
guarda o estado autoritativo da sala, mutações passam por REST, e o socket
distribui o novo estado para os clientes conectados.

O áudio é uma preferência local de cada usuário. O servidor não precisa saber
volume, mute ou se a música está tocando naquele navegador.

## Decisões

### Estado do cronômetro é compartilhado por sala

O estado precisa sobreviver a reload e entrada tardia, então não pode viver só em
estado React nem apenas no hub WebSocket. A sala deve expor um snapshot com:

- modo: `elapsed` para crescente ou `countdown` para regressivo;
- duração configurada, em segundos, quando o modo for regressivo;
- status: parado, rodando ou pausado;
- instante de início/retomada quando está rodando;
- segundos acumulados antes da pausa atual;
- usuário que alterou o estado e instante da última alteração, para auditoria
  simples e depuração.

O tempo exibido no cliente é derivado desse snapshot e do relógio local, com
correção pelo `serverNow` retornado pela API quando necessário. O servidor não
precisa emitir um evento por segundo.

### REST com broadcast, socket só distribui

Seguir o padrão atual da retro:

- `GET /retro/rooms/:id` retorna o snapshot atual do cronômetro junto com a sala.
- `POST /retro/rooms/:id/timer` aplica comandos do facilitador e persiste o novo
  snapshot.
- Após persistir, a API publica `timer.changed` no hub da sala.
- Cliente que reconecta faz refetch da sala e recalcula o tempo.

Comandos esperados: `start`, `pause`, `resume`, `reset` e `configure`. A
configuração pode ser feita antes de iniciar ou no reset, mantendo a regra de que
participantes não comandam o cronômetro.

### Contagem crescente é o padrão

Quando o facilitador não define duração, a sala usa contagem crescente. A
contagem regressiva só exige duração quando o modo escolhido for `countdown`.

No modo regressivo, a interface nunca deve mostrar tempo negativo. Ao chegar a
zero, a UI pode permanecer visualmente em zero mesmo que o estado autoritativo
ainda esteja `running`; a implementação pode decidir se faz auto-stop no cliente
ou se persiste uma transição para parado em uma evolução posterior.

### Música não é sincronizada entre usuários

O cronômetro é sincronizado; o áudio não. Cada cliente toca a trilha ambiente
quando observa o cronômetro rodando, respeitando:

- `muted`;
- `volume`;
- permissões e bloqueios de autoplay do navegador;
- preferência persistida no cliente.

A preferência deve ficar em `localStorage`, com chave versionada e escopo
suficiente para não colidir com outros controles de áudio do produto, por
exemplo `legends:retro:ambientAudio:v1`.

### Trilha gerada localmente, sem dependência externa

A música deve ser sintetizada localmente com Web Audio, em loop simples e suave.
Isso evita dependência externa, arquivo binário no repo e risco de licença: a
melodia é gerada pelo próprio cliente.

Evitar streaming externo: falha de rede, política de terceiros ou mudança de URL
não devem quebrar a dinâmica da retro.

## Contrato sugerido

Em `@legends/shared`, adicionar tipos para a superfície da retro:

```ts
export type RetroTimerMode = 'elapsed' | 'countdown'
export type RetroTimerStatus = 'idle' | 'running' | 'paused'

export type RetroTimerDTO = {
  mode: RetroTimerMode
  status: RetroTimerStatus
  durationSeconds: number | null
  startedAt: string | null
  accumulatedSeconds: number
  updatedAt: string
  updatedBy?: PublicUser
  serverNow: string
}

export type RetroTimerCommand =
  | { action: 'configure'; mode: RetroTimerMode; durationSeconds?: number | null }
  | { action: 'start'; mode?: RetroTimerMode; durationSeconds?: number | null }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'reset'; mode?: RetroTimerMode; durationSeconds?: number | null }
```

O evento WebSocket entra na union existente:

```ts
{ type: 'timer.changed'; roomId: string; timer: RetroTimerDTO }
```

## Persistência

Opção conservadora: novos campos em `RetroRoom`, evitando tabela separada para um
estado 1:1 com a sala:

- `timerMode`
- `timerStatus`
- `timerDurationSeconds`
- `timerStartedAt`
- `timerAccumulatedSeconds`
- `timerUpdatedAt`
- `timerUpdatedById`

Essa escolha mantém a leitura do detalhe da sala simples e evita join extra para
um estado sempre carregado junto do board.

## Permissões

- Facilitador da sala pode configurar e comandar o cronômetro.
- Participantes e observadores autorizados recebem e visualizam o estado.
- Usuários sem acesso à sala não consultam nem recebem eventos do cronômetro.
- Preferências de áudio não passam pela API.

## Frontend

Adicionar um controle compacto ao board de retro, próximo aos controles da sala,
sem competir com as ferramentas de card:

- display do tempo em `mm:ss` ou `hh:mm:ss` quando passar de uma hora;
- seletor de modo crescente/regressivo;
- campo de duração quando regressivo;
- botões de iniciar, pausar/retomar e reiniciar para o facilitador;
- indicador somente leitura para participantes;
- controles individuais de volume e mute para todos.

O cliente deve calcular o display localmente em intervalo curto enquanto o status
for `running`. Eventos de socket atualizam o snapshot; reconnect/refetch corrige
qualquer drift.

## Áudio

- A trilha sintetizada toca em loop enquanto o cronômetro estiver rodando.
- Ao pausar o cronômetro, o cliente pausa a trilha.
- Ao reiniciar para estado parado, o cliente para ou retorna a trilha ao início.
- Se autoplay for bloqueado, a UI deve expor uma ação direta para habilitar som.
- Volume e mute são aplicados por usuário e persistidos localmente.

## Testes esperados na implementação

- Service/API: facilitador comanda; participante não comanda; snapshot calcula
  pausa/retomada; modo regressivo valida duração.
- WebSocket: `timer.changed` chega aos clientes conectados e reconnect refaz o
  snapshot.
- Shared: helpers de cálculo/formatacao, se adicionados ao contrato.
- Web: render do timer por modo/status; comandos do facilitador; visualização de
  participante; persistência de volume/mute em `localStorage`; bloqueio de áudio
  tratado sem quebrar a tela.

## Riscos

- Relógios locais podem divergir; incluir `serverNow` no snapshot reduz drift.
- Autoplay pode ser bloqueado pelo navegador; o fluxo precisa degradar para uma
  ação explícita do usuário.
- Tocar áudio por estado compartilhado não significa sincronizar a posição da
  música; isso é deliberado e evita complexidade sem valor para a dinâmica.
- Se o deploy escalar para múltiplas instâncias, o hub em memória da retro já
  exigirá Redis ou equivalente para eventos em tempo real entre nós.
