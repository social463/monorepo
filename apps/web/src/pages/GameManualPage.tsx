import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  COIN_CAP_WINDOW_LABELS,
  COIN_CURRENCY_LABEL,
  XP_CAP_WINDOW_LABELS,
  XP_CURRENCY_LABEL,
  XP_EVENTS,
  XP_EVENT_DESCRIPTIONS,
  XP_EVENT_LABELS,
  XP_LEVELS,
  XP_LEVEL_ON_COLOR,
  type CoinRulePublicDTO,
  type XpEvent,
  type XpRulePublicDTO,
} from '@legends/shared'
import { useCoinRules, useHasCoins } from '../lib/use-coins'
import { useXpBalance, useXpRules } from '../lib/use-xp'
import { Icon } from '../components/Icon'

/**
 * Cor de um bloco. O tom é fixo (não sai da marca) porque é sinalização de
 * assunto, como já acontece com o metal dos níveis: sequência é laranja,
 * moeda é âmbar, alerta é o `error` do tema.
 *
 * `tint` e `border` são translúcidos de propósito — compõem sobre a surface do
 * tema e por isso não precisam de variante `dark:`. Só o disco do ícone e o
 * selo da seção são sólidos, e nos dois o texto/glifo em cima é branco, com
 * tom escuro o bastante para o contraste fechar em qualquer tema.
 */
interface Accent {
  tint: string
  border: string
  disc: string
  chip: string
}

const ACCENTS = {
  streak: {
    tint: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    disc: 'bg-orange-600 text-white',
    chip: 'bg-orange-700 text-white',
  },
  coins: {
    tint: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    disc: 'bg-amber-600 text-white',
    chip: 'bg-amber-700 text-white',
  },
  levels: {
    tint: 'bg-primary/10',
    border: 'border-primary/30',
    disc: 'bg-primary text-on-primary',
    chip: 'bg-primary text-on-primary',
  },
  freeze: {
    tint: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    disc: 'bg-cyan-600 text-white',
    chip: '',
  },
  alert: {
    tint: 'bg-error/10',
    border: 'border-error/30',
    disc: 'bg-error text-on-error',
    chip: '',
  },
  points: {
    tint: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    disc: 'bg-violet-600 text-white',
    chip: '',
  },
  badges: {
    tint: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    disc: 'bg-emerald-600 text-white',
    chip: '',
  },
} satisfies Record<string, Accent>

/** Cor de cada card de ação, na ordem do catálogo de eventos. */
const ACTION_ACCENTS: Accent[] = [
  { tint: 'bg-sky-500/10', border: 'border-sky-500/30', disc: 'bg-sky-600 text-white', chip: '' },
  { tint: 'bg-rose-500/10', border: 'border-rose-500/30', disc: 'bg-rose-600 text-white', chip: '' },
  { tint: 'bg-violet-500/10', border: 'border-violet-500/30', disc: 'bg-violet-600 text-white', chip: '' },
  { tint: 'bg-amber-500/10', border: 'border-amber-500/30', disc: 'bg-amber-600 text-white', chip: '' },
  { tint: 'bg-emerald-500/10', border: 'border-emerald-500/30', disc: 'bg-emerald-600 text-white', chip: '' },
]

/** Ícone de cada ação que rende ponto ou coin. */
const EVENT_ICONS: Record<XpEvent, string> = {
  VOTE_CAST: 'how_to_vote',
  FEEDBACK_PUBLISHED: 'forum',
  FEEDBACK_REACTION: 'favorite',
  MOOD_ANSWERED: 'mood',
  CHALLENGE_APPROVED: 'flag',
  CORPORATE_POST_REACTION: 'sentiment_satisfied',
  CORPORATE_POST_COMMENT: 'chat_bubble',
  CORPORATE_POST_READ_FULL: 'menu_book',
}

/** Ícone de cada degrau, do metal mais baixo ao mais alto. */
const LEVEL_ICONS = ['military_tech', 'star', 'emoji_events', 'shield', 'diamond']

/**
 * Manual do Game: como se ganha ponto, coin e nível **nesta empresa**.
 *
 * Os textos são os oficiais de Gente e Gestão. Onde o texto oficial descrevia a
 * mecânica do portal antigo (streak por acesso com "freeze" de um dia, emblema
 * pedido com comprovação), ele foi ajustado para o que o Legends de fato faz —
 * um manual bonito e mentiroso vira chamado no dia seguinte. O resto está
 * palavra por palavra.
 *
 * Já os VALORES saem das regras ativas cadastradas no admin, e não de texto
 * fixo: cada cliente configura os próprios números, e uma tabela escrita à mão
 * viraria mentira na primeira mudança.
 */
export function GameManualPage() {
  const hasCoins = useHasCoins()
  const xpRules = useXpRules()
  const coinRules = useCoinRules(hasCoins)
  const xpBalance = useXpBalance()

  const xp = xpRules.data?.rules ?? []
  const coins = coinRules.data?.rules ?? []
  // Mesma regra do card de perfil: sem ponto nenhum não há degrau alcançado, e
  // marcar "Você está aqui" no Bronze anunciaria uma conquista que não houve.
  const points = xpBalance.data?.points ?? 0
  const level = points > 0 ? (xpBalance.data?.level ?? null) : null

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Manual do Game</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Entenda como funciona a gamificação do portal e turbine sua evolução.
        </p>
      </header>

      <StreakSection />

      <EarningSection xp={xp} coins={coins} hasCoins={hasCoins} />

      <LevelsSection points={points} level={level} />
    </section>
  )
}

/** Um bloco da página: selo da seção, título com ícone, linha de apoio e o conteúdo. */
function Block({
  accent,
  section,
  icon,
  title,
  subtitle,
  children,
}: {
  accent: Accent
  section: string
  icon: string
  title: ReactNode
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className={`rounded-2xl border ${accent.border} ${accent.tint} p-lg`}>
      <header className="flex items-center gap-md">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${accent.disc}`}>
          <Icon name={icon} className="text-[28px]" />
        </span>
        <div>
          <span
            className={`inline-block rounded-full px-sm py-0.5 font-label text-label-sm ${accent.chip}`}
          >
            {section}
          </span>
          <h2 className="mt-1 font-headline text-headline-sm text-on-surface">{title}</h2>
          <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

/**
 * Sequência ativa. As regras descritas aqui são as do `streak-service`: a
 * sequência conta dias ÚTEIS com humor registrado, o fim de semana é ponte e o
 * dia corrente ainda em aberto não quebra nada.
 *
 * O texto oficial da G&G falava em "entrar e interagir no portal" e num freeze
 * de um dia útil inteiro de ausência — as duas coisas são do portal antigo, e
 * aqui um dia útil sem registro já zera. As frases foram ajustadas ao que o
 * serviço faz; o formato e o tom são os oficiais.
 */
function StreakSection() {
  return (
    <Block
      accent={ACCENTS.streak}
      section="Seção 1"
      icon="local_fire_department"
      title={
        <>
          <span aria-hidden>🔥 </span>Sequência Ativa (Streak)
        </>
      }
      subtitle="O Foguinho da Consistência"
    >
      <p className="mt-md text-body-md text-on-surface">
        A consistência é a chave! Cada <strong>dia útil (Segunda a Sexta)</strong> em que você registra o
        humor do dia no portal, sua sequência aumenta em <strong>+1 dia</strong>. Finais de semana{' '}
        <em>não contam</em> para quebrar e nem para aumentar sua sequência.
      </p>

      <div className="mt-md grid gap-md md:grid-cols-2">
        <InfoBox
          accent={ACCENTS.freeze}
          icon="ac_unit"
          title="Segunda Chance"
          text={
            <>
              Ainda não registrou hoje? Sem estresse. Enquanto o dia útil não termina, a sua sequência
              continua <strong>de pé</strong>, contada pelo último registro.
            </>
          }
        />
        <InfoBox
          accent={ACCENTS.alert}
          icon="warning"
          title="Atenção!"
          text={
            <>
              Se <strong>um dia útil inteiro</strong> passar sem registro, o foguinho apaga 💨 e sua
              sequência zera. A sua melhor marca continua guardada.
            </>
          }
        />
      </div>
    </Block>
  )
}

function InfoBox({
  accent,
  icon,
  title,
  text,
}: {
  accent: Accent
  icon: string
  title: string
  text: ReactNode
}) {
  return (
    <div className={`rounded-xl border ${accent.border} bg-surface p-md`}>
      <h3 className="flex items-center gap-sm font-label text-label-lg text-on-surface">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent.disc}`}>
          <Icon name={icon} className="text-[20px]" />
        </span>
        {title}
      </h3>
      <p className="mt-sm text-body-sm text-on-surface-variant">{text}</p>
    </div>
  )
}

/** O que cada ação rende, e para que serve cada coisa. */
function EarningSection({
  xp,
  coins,
  hasCoins,
}: {
  xp: XpRulePublicDTO[]
  coins: CoinRulePublicDTO[]
  hasCoins: boolean
}) {
  const xpByEvent = new Map(xp.map((rule) => [rule.event, rule]))
  // Chave `string`: os eventos do Feed Corporativo existem em XP e não em
  // coins, então `CoinEvent` é um subconjunto de `XpEvent` — a busca por evento
  // de XP nesta tabela é legítima e simplesmente não acha nada.
  const coinByEvent = new Map<string, CoinRulePublicDTO>(coins.map((rule) => [rule.event, rule]))
  // A ordem é a do catálogo de eventos, não a que a API devolveu: assim os
  // cards não trocam de lugar (nem de cor) quando o admin edita uma regra.
  const events = XP_EVENTS.filter((event) => xpByEvent.has(event) || coinByEvent.has(event))

  return (
    <Block
      accent={ACCENTS.coins}
      section="Seção 2"
      icon="stars"
      title={
        hasCoins ? (
          <>
            <span aria-hidden>🪙 </span>
            {COIN_CURRENCY_LABEL} &amp; {XP_CURRENCY_LABEL}
          </>
        ) : (
          <>
            <span aria-hidden>🏆 </span>
            {XP_CURRENCY_LABEL}
          </>
        )
      }
      subtitle="Como acumular e evoluir"
    >
      {events.length === 0 ? (
        <p className="mt-md text-body-sm text-on-surface-variant">
          A sua empresa ainda não configurou regras de pontuação.
        </p>
      ) : (
        <div className="mt-md grid gap-md sm:grid-cols-2 lg:grid-cols-4">
          {events.map((event) => (
            <ActionCard
              key={event}
              event={event}
              accent={ACTION_ACCENTS[XP_EVENTS.indexOf(event) % ACTION_ACCENTS.length]!}
              xp={xpByEvent.get(event) ?? null}
              coin={coinByEvent.get(event) ?? null}
              hasCoins={hasCoins}
            />
          ))}
        </div>
      )}

      {/* A moeda vem primeiro: é a dúvida que traz a pessoa até aqui. Sem a
          feature, os pontos assumem o lugar dela. */}
      <div className="mt-md grid gap-md md:grid-cols-2 lg:grid-cols-3">
        {hasCoins && (
          <PurposeCard
            accent={ACCENTS.coins}
            icon="shopping_bag"
            title={`🪙 Para que servem as ${COIN_CURRENCY_LABEL}?`}
            text={
              <>
                As <strong>{COIN_CURRENCY_LABEL}</strong> que você acumula realizando suas interações
                diárias são valiosas e servirão para você{' '}
                <strong>trocar por recompensas exclusivas, vantagens e itens incríveis</strong> na nossa{' '}
                <Link to="/loja" className="font-bold text-primary hover:underline">
                  Lojinha EMR
                </Link>
                !
              </>
            }
          />
        )}
        <PurposeCard
          accent={ACCENTS.points}
          icon="trending_up"
          title={`🏆 Para que servem os ${XP_CURRENCY_LABEL.toLowerCase()}?`}
          text={
            <>
              Os {XP_CURRENCY_LABEL.toLowerCase()} são o seu <strong>XP de evolução</strong>: eles definem
              o seu <strong>nível</strong> no portal, a sua posição no{' '}
              <Link to="/ranking" className="font-bold text-primary hover:underline">
                Ranking
              </Link>{' '}
              e desbloqueiam <strong>emblemas e conquistas exclusivas</strong> no seu perfil. Diferente das{' '}
              {COIN_CURRENCY_LABEL}, os {XP_CURRENCY_LABEL.toLowerCase()} nunca são gastos — eles marcam a
              sua jornada de crescimento.
            </>
          }
        />
        <PurposeCard
          accent={ACCENTS.badges}
          icon="military_tech"
          title="🏅 Para que servem os Emblemas?"
          text={
            <>
              Os <strong>Emblemas</strong> são as honrarias oficiais que coroam os seus marcos e
              conquistas reais na empresa! Eles chegam sozinhos assim que o critério é cumprido — tempo de
              casa, cursos concluídos, ações de PDI, participação —, e o time de{' '}
              <strong>Gente e Gestão</strong> também pode conceder um emblema manualmente. Quando isso
              acontece, a insígnia fica colorida no seu perfil e em{' '}
              <Link to="/engajamento" className="font-bold text-primary hover:underline">
                Meus Emblemas
              </Link>{' '}
              na hora! 🚀
            </>
          }
        />
      </div>
    </Block>
  )
}

/** Um card de ação: o que fazer e quanto rende em cada moeda. */
function ActionCard({
  event,
  accent,
  xp,
  coin,
  hasCoins,
}: {
  event: XpEvent
  accent: Accent
  xp: XpRulePublicDTO | null
  coin: CoinRulePublicDTO | null
  hasCoins: boolean
}) {
  return (
    <div className={`flex flex-col rounded-xl border ${accent.border} ${accent.tint} p-md`}>
      <span className={`mb-md flex h-12 w-12 items-center justify-center rounded-xl ${accent.disc}`}>
        <Icon name={EVENT_ICONS[event]} className="text-[24px]" />
      </span>
      <h3 className="font-label text-label-lg text-on-surface">{XP_EVENT_LABELS[event]}</h3>
      <p className="mt-1 flex-1 text-body-sm text-on-surface-variant">{XP_EVENT_DESCRIPTIONS[event]}</p>

      <dl className="mt-md flex flex-col gap-1">
        <AmountRow label={XP_CURRENCY_LABEL} rule={xp} capLabels={XP_CAP_WINDOW_LABELS} />
        {hasCoins && <AmountRow label={COIN_CURRENCY_LABEL} rule={coin} capLabels={COIN_CAP_WINDOW_LABELS} />}
      </dl>
    </div>
  )
}

/** "Pontos … +15" com o teto embaixo; traço quando a ação não paga na moeda. */
function AmountRow({
  label,
  rule,
  capLabels,
}: {
  label: string
  rule: XpRulePublicDTO | CoinRulePublicDTO | null
  capLabels: Record<string, string>
}) {
  return (
    <div className="rounded-lg bg-surface px-sm py-1">
      <div className="flex items-center justify-between gap-sm">
        <dt className="text-body-sm text-on-surface-variant">{label}</dt>
        <dd className={`font-label text-label-lg tabular-nums ${rule ? 'text-primary' : 'text-on-surface-variant'}`}>
          {rule ? `+${rule.amount.toLocaleString('pt-BR')}` : '—'}
        </dd>
      </div>
      {rule && <p className="text-body-sm text-on-surface-variant">{capText(rule, capLabels)}</p>}
    </div>
  )
}

/** "Até 100 por semana" — ou "Sem limite" quando a regra não tem teto. */
function capText(rule: XpRulePublicDTO | CoinRulePublicDTO, labels: Record<string, string>): string {
  if (rule.capWindow === 'NONE' || rule.capAmount == null) return 'Sem limite'
  return `Até ${rule.capAmount.toLocaleString('pt-BR')} ${labels[rule.capWindow]!.toLowerCase()}`
}

function PurposeCard({
  accent,
  icon,
  title,
  text,
}: {
  accent: Accent
  icon: string
  title: string
  text: ReactNode
}) {
  return (
    <div className={`rounded-2xl border ${accent.border} ${accent.tint} p-md`}>
      <h3 className="flex items-start gap-sm font-label text-label-lg text-on-surface">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent.disc}`}>
          <Icon name={icon} className="text-[22px]" />
        </span>
        {title}
      </h3>
      <p className="mt-sm text-body-sm text-on-surface-variant">{text}</p>
    </div>
  )
}

/** A faixa de pontos de um degrau: "0 – 499" e, no topo, "7.500+". */
function levelRange(index: number): string {
  const tier = XP_LEVELS[index]!
  const next = XP_LEVELS[index + 1]
  const min = tier.min.toLocaleString('pt-BR')
  if (!next) return `${min}+`
  return `${min} – ${(next.min - 1).toLocaleString('pt-BR')}`
}

/** Os degraus e onde você está neles. */
function LevelsSection({
  points,
  level,
}: {
  points: number
  level: { name: string; next: string | null; remaining: number; progress: number; nextMin: number | null } | null
}) {
  return (
    <Block
      accent={ACCENTS.levels}
      section="Seção 3"
      icon="emoji_events"
      title={
        <>
          <span aria-hidden>🏆 </span>Níveis &amp; Conquistas
        </>
      }
      subtitle="Evolução do seu perfil"
    >
      <ol className="mt-md grid gap-md sm:grid-cols-3 lg:grid-cols-5">
        {XP_LEVELS.map((tier, index) => {
          const current = level?.name === tier.name
          return (
            <li
              key={tier.name}
              className={`flex flex-col items-center gap-sm rounded-xl border bg-surface p-md text-center ${
                current ? 'border-transparent' : 'border-outline-variant/40'
              }`}
              // O degrau alcançado é marcado pela cor do metal, não por uma cor
              // de marca: bronze é bronze em qualquer tenant.
              style={current ? { outline: `2px solid ${tier.color}`, outlineOffset: '-2px' } : undefined}
            >
              {/* O disco leva a cor do metal; o glifo herda `color` do span —
                  o `Icon` não recebe estilo inline. */}
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: tier.color, color: XP_LEVEL_ON_COLOR }}
              >
                <Icon name={LEVEL_ICONS[index] ?? 'workspace_premium'} className="text-[32px]" />
              </span>
              <div>
                <p className="font-label text-label-lg font-bold text-on-surface">{tier.name}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {levelRange(index)} {XP_CURRENCY_LABEL.toLowerCase()}
                </p>
              </div>
              {current && <p className="font-label text-label-sm text-on-surface">Você está aqui</p>}
            </li>
          )
        })}
      </ol>

      {level ? (
        <div className="mt-md rounded-xl border border-outline-variant/40 bg-surface p-md">
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <p className="font-label text-label-lg text-on-surface">
              {points.toLocaleString('pt-BR')}
              {level.nextMin ? ` / ${level.nextMin.toLocaleString('pt-BR')}` : ''}{' '}
              {XP_CURRENCY_LABEL.toLowerCase()}
            </p>
            <p className="text-body-sm text-on-surface-variant">
              Nível: <strong className="text-on-surface">{level.name}</strong>
              {level.next ? ` → ${level.next}` : ''}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={level.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso para o próximo nível"
            className="mt-sm h-3 overflow-hidden rounded-full bg-surface-container-highest"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${level.progress}%` }} />
          </div>
          <p className="mt-sm text-body-sm text-on-surface-variant">
            {level.next
              ? `Faltam ${level.remaining.toLocaleString('pt-BR')} ${XP_CURRENCY_LABEL.toLowerCase()} para o próximo nível.`
              : 'Você chegou ao último nível.'}
          </p>
        </div>
      ) : (
        <p className="mt-md text-body-sm text-on-surface-variant">
          O seu nível aparece aqui a partir do primeiro ponto ganho.
        </p>
      )}

      <div className="mt-md flex items-start gap-sm rounded-xl border border-primary/25 bg-surface p-md">
        <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-[20px] text-primary" />
        <p className="text-body-sm text-on-surface">
          <strong>Suba de nível acumulando {XP_CURRENCY_LABEL.toLowerCase()}!</strong> Quanto maior o seu
          nível, maior o seu destaque no{' '}
          <Link to="/ranking" className="font-bold text-primary hover:underline">
            Ranking
          </Link>{' '}
          da nossa empresa e mais <strong>emblemas exclusivos</strong> você conquista no seu perfil.
        </p>
      </div>
    </Block>
  )
}
