# Analytics — adoção por empresa e por setor

## Problema

O Legends é multi-empresa e multi-setor, e não há como responder a pergunta que
mais importa para quem vende e opera o produto: **quem está usando, e o quê**.

O que existe hoje é navegação. O `AccessLog` grava `(userId, path, companyId)` a
cada troca de rota, e o People Analytics agrega isso em `/admin/pessoas`. É útil,
mas responde "quais telas abriram" — não "quantas empresas votaram este mês",
"qual setor abandonou a ferramenta", "alguém usa o agente de IA". E o `AccessLog`
não guarda setor: ele sai de um join com `User`, que reescreve o passado quando a
pessoa muda de área.

O `AdminAuditLog` também não serve: ele registra ação de admin sobre entidade,
com `before`/`after`, e existe para prestar contas — não para medir uso.

## Entrega

Um evento de produto nomeado, com empresa e setor gravados no momento em que
acontece, indo para dois destinos ao mesmo tempo; e um painel cross-company no
console interno.

### Decisões

**Dois sinks, com papéis distintos.** O Postgres (`AnalyticsEvent`) é a fonte de
verdade: alimenta o painel do super-admin e guarda a série completa. O GA4 recebe
o mesmo evento e serve à exploração de comportamento na interface do Google.

A divisão não é preciosismo. O GA4 retém evento por **no máximo 14 meses**, e
"entender o uso das empresas" é pergunta de tendência longa — comparação ano
contra ano simplesmente não existe lá. Além disso, alimentar uma tela do próprio
app a partir do GA4 exigiria a Data API, com dado atrasado, amostrado e sujeito a
quota: dependência ruim para uma tela interna. Com o Postgres como base, trocar o
sink externo depois é escrever um arquivo, sem perder histórico.

**Empresa e setor são ambientes, não argumentos.** Nenhum call site passa tenant:
`captureFor(request, ...)` extrai do JWT, que já carrega `companyId`, `sectorId`,
`role` e `sub`. Evento sem empresa é evento inútil, e depender da memória de quem
instrumenta garante que uns tenham e outros não.

**`sectorId` é snapshot, não relação.** Gravado no evento e nunca derivado por
join. Quem muda de setor não leva o histórico junto — senão a série por setor
mentiria sobre o passado.

**Pseudonimizado.** Só UUID. Nome, e-mail e qualquer texto escrito por pessoa
(justificativa de voto, feedback) nunca saem do banco. `feedback_given` leva o
`length` da mensagem, não a mensagem: mostra se as pessoas escrevem de verdade
sem exportar o que alguém escreveu sobre um colega. É produto de RH, o sink
externo é de terceiro, e é a LGPD que paga a conta de um vazamento.

**O front não emite evento de domínio.** `WEB_ANALYTICS_EVENT_NAMES` limita a web
a page view e telas abertas. Se o navegador pudesse mandar `vote_cast`, qualquer
pessoa com o console aberto inflaria a adoção da própria empresa, e o painel do
super-admin viraria ficção.

**Telemetria nunca derruba request.** `capture()` retorna `void` de propósito —
se devolvesse Promise, um `await` distraído colocaria a latência do GA4 dentro da
resposta ao usuário. Cada sink é isolado: o Google fora do ar não impede o
Postgres de gravar. Erro é logado e engolido, igual ao `useAccessLogPing` e à
avaliação de selos pós-voto.

**Sem chave, tudo é no-op.** `resolveGa4Config` devolve `null` em vez de lançar,
inclusive em produção — ao contrário de `JWT_SECRET`. Derrubar o boot da API por
falta de chave de métrica trocaria perda de dado por indisponibilidade. No front,
sem `VITE_GA4_MEASUREMENT_ID` nenhum script do Google é carregado. Foi o que
permitiu escrever tudo antes de a conta do GA4 existir.

## Modelo de dados

`AnalyticsEvent`: `name`, `userId?`, `sectorId?`, `companyId`, `source`, `props`,
`occurredAt`. Índices por `[companyId, occurredAt]`, `[companyId, name,
occurredAt]` e `[companyId, sectorId, occurredAt]` — as três consultas do painel.

`onDelete: SetNull` no usuário, e não `Cascade` como no `AccessLog`: apagar a
pessoa apaga o vínculo com ela e preserva o agregado da empresa. Atende o direito
à eliminação da LGPD sem abrir buraco retroativo no painel.

Registrado em `TENANT_SCOPED_MODELS`: gravação por engano dentro do escopo de
outra empresa esbarra em `TenantScopeError` em vez de contaminar o painel calado.

## Restrições do GA4 que moldaram o código

Property padrão: 50 custom dimensions event-scoped, 25 user-scoped, retenção de
14 meses. `companyId`/`sectorId`/`role` vão como **user properties** — é o que
permite segmentar qualquer relatório por tenant.

Measurement Protocol: nome de evento ≤40 caracteres (o teste do catálogo trava),
valor de parâmetro ≤100, user property ≤36, e **backdating de no máximo 72h**.
Fora dessa janela o `timestamp_micros` é omitido em vez de mandado: a hora fica
errada, mas o evento sobrevive — e para contagem de adoção o evento importa mais.

O ponto que justifica todo esse cuidado: **fora do modo debug, o GA4 responde 204
mesmo para payload inválido**. Ele nunca avisa que descartou. Por isso os limites
são tratados no código, e não descobertos em produção com um painel plausível e
errado.

## Fora de escopo

- **Page view continua no `AccessLog`.** Já funciona, já tem índice e telas. O
  mesmo sinal é espelhado no GA4; nenhuma tabela nova.
- **Rotação de refresh token não vira evento.** Acontece a cada 15 minutos para
  toda sessão viva, é automática e afogaria o resto do volume.
- **Provedor e modelo de IA não entram em `ai_agent_invoked`.** São configuração
  da empresa (`AppSetting`), não fato do evento; repetir criaria uma segunda
  fonte de verdade que diverge no dia em que o admin troca de provedor.
- **Painel para o ADMIN do cliente.** Só o SUPER_ADMIN vê, por ora.
