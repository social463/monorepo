# PRD — Cronômetro e música ambiente na retrospectiva

**Data:** 2026-08-04
**PBI:** #22336 — "Melhorias sessão de retrospective"
**Branch:** `feat/22336-retro-cronometro-musica`
**Status:** Ready for implementation

## Problema

A página de retrospectiva do Legends já está funcional e utilizável, mas a
condução do momento de preenchimento dos cards ainda depende de controle externo
de tempo. O facilitador precisa acompanhar a duração por fora, e os participantes
não têm uma referência comum de quanto tempo já passou ou quanto tempo resta para
concluir os campos da retro.

Além disso, a etapa de preenchimento pode ficar mais leve se houver uma trilha
ambiente tranquila enquanto o cronômetro está rodando, desde que cada usuário
mantenha controle individual do próprio áudio.

## Objetivos

- Exibir um cronômetro compartilhado dentro da sala de retrospectiva.
- Manter o cronômetro sincronizado em tempo real para todos os usuários daquela
  retro.
- Permitir contagem crescente sem tempo final definido.
- Permitir contagem regressiva com duração definida pelo facilitador.
- Tocar música ambiente tranquila, sem direitos autorais, quando o cronômetro
  for iniciado.
- Permitir volume e mute individuais para cada usuário.
- Preservar a preferência individual de áudio após recarregar a tela.

## Usuários

- **Facilitador da retro:** inicia, pausa/retoma, reinicia e configura o modo do
  cronômetro.
- **Participante convidado:** acompanha o cronômetro em tempo real e controla
  apenas seu próprio áudio.
- **Observador autorizado:** acompanha o estado da retro e o cronômetro, sem
  comandar a dinâmica.

## Histórias

### P1: Cronômetro compartilhado

**User Story:** Como facilitador, quero iniciar um cronômetro visível para todos
os usuários da retro para conduzir o preenchimento dos cards com uma referência
comum de tempo.

**Critérios de aceite:**

1. WHEN o facilitador inicia o cronômetro THEN todos os usuários conectados à
   sala SHALL ver o tempo rodando com a mesma referência.
2. WHEN um usuário entra ou recarrega a página durante uma contagem ativa THEN a
   tela SHALL exibir o tempo atual correto da retro.
3. WHEN o facilitador pausa a contagem THEN todos os usuários SHALL ver o
   cronômetro pausado no mesmo ponto.
4. WHEN o facilitador retoma a contagem THEN todos os usuários SHALL ver a
   contagem continuar a partir do ponto pausado.
5. WHEN o facilitador reinicia o cronômetro THEN todos os usuários SHALL ver o
   estado zerado conforme o modo selecionado.

**Independent Test:** Abrir a mesma sala em dois navegadores, iniciar o
cronômetro em um deles e confirmar que o outro exibe o mesmo estado sem recarregar.

### P1: Modo crescente e regressivo

**User Story:** Como facilitador, quero escolher entre contar o tempo decorrido
ou definir uma duração para contagem regressiva, para adaptar a dinâmica ao tipo
de retro.

**Critérios de aceite:**

1. WHEN o modo crescente é escolhido THEN o cronômetro SHALL começar em zero e
   mostrar o tempo decorrido.
2. WHEN o modo regressivo é escolhido com duração válida THEN o cronômetro SHALL
   mostrar o tempo restante até zero.
3. WHEN a contagem regressiva chega a zero THEN a interface SHALL permanecer em
   zero, sem exibir tempo negativo.
4. WHEN nenhuma duração é definida THEN o comportamento padrão SHALL ser
   contagem crescente.

**Independent Test:** Iniciar uma contagem crescente e uma regressiva curta,
confirmando o sentido da contagem e o estado final em zero no modo regressivo.

### P1: Música ambiente vinculada ao cronômetro

**User Story:** Como participante, quero ouvir uma música ambiente tranquila
enquanto o cronômetro roda para preencher os campos da retro com mais conforto.

**Critérios de aceite:**

1. WHEN o cronômetro é iniciado THEN uma música ambiente tranquila SHALL tocar
   para o usuário quando o navegador permitir reprodução de áudio.
2. WHEN o cronômetro é pausado ou reiniciado para estado parado THEN a música
   SHALL acompanhar esse estado.
3. WHEN o navegador bloquear autoplay THEN a tela SHALL permitir que o usuário
   habilite o áudio sem quebrar a contagem compartilhada.
4. A trilha usada SHALL ser sem direitos autorais e adequada para uso corporativo.

**Independent Test:** Iniciar o cronômetro e confirmar que a música começa no
cliente; pausar o cronômetro e confirmar que o áudio não continua tocando como se
a sessão ainda estivesse em execução.

### P1: Volume e mute individuais

**User Story:** Como usuário da retro, quero controlar o volume ou mutar a música
somente para mim para participar da dinâmica sem afetar os colegas.

**Critérios de aceite:**

1. WHEN um usuário altera o volume THEN apenas o áudio desse usuário SHALL mudar.
2. WHEN um usuário ativa mute THEN apenas o áudio desse usuário SHALL ficar mudo.
3. WHEN o usuário recarrega a página THEN volume e mute SHALL ser restaurados de
   acordo com a preferência salva localmente.
4. WHEN outro usuário altera seu áudio THEN a minha configuração SHALL permanecer
   intacta.

**Independent Test:** Abrir a sala em dois navegadores, mutar em um deles,
recarregar esse navegador e confirmar que o mute persiste sem alterar o outro.

## Requisitos rastreáveis

| ID | Requisito | Prioridade | Status |
| --- | --- | --- | --- |
| RETRO-TIMER-01 | Cronômetro visível na sala de retro para todos os usuários autorizados. | P1 | Pending |
| RETRO-TIMER-02 | Estado do cronômetro sincronizado em tempo real por sala. | P1 | Pending |
| RETRO-TIMER-03 | Comandos de iniciar, pausar/retomar e reiniciar disponíveis ao facilitador. | P1 | Pending |
| RETRO-TIMER-04 | Suporte a contagem crescente sem duração final. | P1 | Pending |
| RETRO-TIMER-05 | Suporte a contagem regressiva com duração opcional definida. | P1 | Pending |
| RETRO-TIMER-06 | Música ambiente sem direitos autorais associada ao início do cronômetro. | P1 | Pending |
| RETRO-TIMER-07 | Controle individual de volume e mute. | P1 | Pending |
| RETRO-TIMER-08 | Persistência local da preferência de áudio após reload. | P1 | Pending |

## Fora de escopo

- Criar tasks filhas no PBI.
- Implementar relatórios históricos de duração das retrospectivas.
- Criar métricas analíticas de tempo médio por usuário ou por sala.
- Permitir upload de músicas, playlist ou integração com serviços externos.
- Sincronizar volume, mute ou posição da música entre usuários.
- Alterar as regras atuais de criação, participação, fases, cards, votos ou
  reações da retro.

## Métricas de sucesso

- Facilitador consegue conduzir o preenchimento usando apenas o cronômetro da
  sala.
- Participantes veem o mesmo estado de tempo sem precisar atualizar a página.
- Usuários mantêm autonomia sobre o áudio sem interferir nos demais.
- A feature não degrada o fluxo atual de escrita, votação, reação e conclusão da
  retrospectiva.

## Dúvidas pendentes

- Qual duração padrão, se houver, deve ser sugerida para contagem regressiva?
- A música deve começar pausada quando o navegador bloquear autoplay ou deve haver
  um botão explícito para habilitar áudio antes de iniciar a dinâmica?
