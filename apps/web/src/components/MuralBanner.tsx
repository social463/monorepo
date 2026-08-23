import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { FeedbackCategory, MuralItemDTO, MuralResponse } from '@legends/shared'
import { FEEDBACK_CATEGORY_LABELS } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { badgeAccentColor } from '../lib/badge-art'
import { Avatar } from './Avatar'
import { BadgeEmblem } from './BadgeEmblem'
import { Icon } from './Icon'

const ROTATE_MS = 6000

// Acento dedicado dos avisos de humor do dia.
const MOOD_ACCENT = '#f472b6'

// Acento dedicado das resenhas no mural.
const REVIEW_ACCENT = '#818cf8'

// Acento por categoria (só POSITIVO/ELOGIO chegam ao mural; as demais ficam para completude de tipo).
const FEEDBACK_ACCENT: Record<FeedbackCategory, string> = {
  POSITIVO: '#34d399',
  ELOGIO: '#f59e0b',
  ORIENTACAO: '#38bdf8',
  MELHORIA: '#a78bfa',
}

function accentOf(item: MuralItemDTO): string {
  if (item.type === 'feedback') return FEEDBACK_ACCENT[item.category]
  if (item.type === 'mood') return MOOD_ACCENT
  if (item.type === 'review') return REVIEW_ACCENT
  return badgeAccentColor(item.badge.iconKey, item.badge.kind)
}

/** Destino do clique: a própria publicação, destacada. Feedback e selo moram no perfil de
 * quem recebeu (query param); a resenha mora no feed, no mesmo deep-link por hash que as
 * notificações usam (`/resenha#<id>`). Humor não tem publicação — só o perfil de quem
 * respondeu, porque o humor em si nunca é exposto. */
function itemHref(item: MuralItemDTO): string {
  if (item.type === 'feedback') return `/perfil/${item.target.id}?feedback=${item.id}`
  if (item.type === 'mood') return `/perfil/${item.user.id}`
  if (item.type === 'review') return `/resenha#${item.id}`
  return `/perfil/${item.user.id}?badge=${item.id}`
}

function FeedbackSlide({ item, accent }: { item: Extract<MuralItemDTO, { type: 'feedback' }>; accent: string }) {
  return (
    <div className="relative flex min-h-[156px] flex-col justify-center gap-md px-lg py-lg sm:min-h-[172px] sm:px-xl">
      <blockquote className="relative">
        <span
          aria-hidden
          className="absolute -left-1 -top-7 font-headline text-[68px] leading-none"
          style={{ color: accent, opacity: 0.28 }}
        >
          &ldquo;
        </span>
        <p className="relative line-clamp-2 font-headline text-headline-md text-on-surface">{item.message}</p>
      </blockquote>
      <div className="flex flex-wrap items-center gap-sm">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
          <Avatar user={item.target} />
        </span>
        <p className="font-label text-label-md text-on-surface-variant">
          <span className="text-on-surface">{item.author.name}</span> deu feedback para{' '}
          <span className="text-on-surface">{item.target.name}</span>
        </p>
        <span
          className="rounded-full px-sm py-0.5 font-label text-label-sm font-bold"
          style={{ backgroundColor: `${accent}26`, color: accent }}
        >
          {FEEDBACK_CATEGORY_LABELS[item.category]}
        </span>
      </div>
    </div>
  )
}

function BadgeSlide({ item, accent }: { item: Extract<MuralItemDTO, { type: 'badge' }>; accent: string }) {
  return (
    <div className="relative flex min-h-[156px] items-center gap-lg px-lg py-lg sm:min-h-[172px] sm:px-xl">
      <div className="relative shrink-0">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ backgroundColor: accent, opacity: 0.35 }}
        />
        <span className="relative">
          <BadgeEmblem badge={{ iconKey: item.badge.iconKey, kind: item.badge.kind, name: item.badge.name }} size={76} />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-xs">
        <span className="font-label text-label-sm font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
          Novo selo
        </span>
        <p className="font-headline text-headline-md text-on-surface">{item.badge.name}</p>
        <p className="font-label text-label-md text-on-surface-variant">conquistado por {item.user.name}</p>
        <p className="line-clamp-2 text-body-sm text-on-surface-variant">{item.badge.description}</p>
      </div>
    </div>
  )
}

function MoodSlide({ item, accent }: { item: Extract<MuralItemDTO, { type: 'mood' }>; accent: string }) {
  return (
    <div className="relative flex min-h-[156px] items-center gap-lg px-lg py-lg sm:min-h-[172px] sm:px-xl">
      <div className="relative shrink-0">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ backgroundColor: accent, opacity: 0.3 }}
        />
        <span className="relative flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
          <Avatar user={item.user} />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-xs">
        <span className="font-label text-label-sm font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
          Humor do dia
        </span>
        <p className="font-headline text-headline-md text-on-surface">
          <span>{item.user.name}</span> respondeu ao humor do dia
        </p>
      </div>
    </div>
  )
}

function ReviewSlide({ item }: { item: Extract<MuralItemDTO, { type: 'review' }> }) {
  return (
    <div className="flex min-h-[156px] flex-col gap-sm px-lg py-lg sm:min-h-[172px] sm:px-xl">
      <div className="flex items-center gap-sm">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
          <Avatar user={item.author} />
        </div>
        <p className="font-label text-label-md text-on-surface">{item.author.name}</p>
      </div>
      <p className="line-clamp-3 text-body-sm text-on-surface">{item.content}</p>
      {item.sharers.length > 0 && (
        <p className="font-label text-label-sm text-on-surface-variant">
          compartilhado por {item.sharers.map((s) => s.name).join(', ')}
        </p>
      )}
    </div>
  )
}

function Slide({ item, accent }: { item: MuralItemDTO; accent: string }) {
  if (item.type === 'feedback') return <FeedbackSlide item={item} accent={accent} />
  if (item.type === 'mood') return <MoodSlide item={item} accent={accent} />
  if (item.type === 'review') return <ReviewSlide item={item} />
  return <BadgeSlide item={item} accent={accent} />
}

export function MuralBanner() {
  const { data } = useQuery({
    queryKey: ['mural'],
    queryFn: () => apiFetch<MuralResponse>('/mural'),
  })
  const items = data?.items ?? []
  const [index, setIndex] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)
  const paused = useRef(false)

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    setReduceMotion(matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    if (reduceMotion || items.length <= 1) return
    const timer = setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % items.length)
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [reduceMotion, items.length])

  if (items.length === 0) {
    return (
      <section
        data-testid="mural-banner-empty"
        aria-label="Pulso do time"
        className="flex items-center gap-md rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg"
      >
        <span className="text-on-surface-variant">
          <Icon name="campaign" className="text-[22px]" />
        </span>
        <div>
          <p className="font-label text-label-sm font-bold uppercase tracking-[0.18em] text-on-surface-variant">
            Pulso do time
          </p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            O pulso do time aparece aqui — feedbacks, selos e resenhas compartilhadas.
          </p>
        </div>
      </section>
    )
  }

  const active = index % items.length
  const item = items[active]
  const accent = accentOf(item)
  const go = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length)

  return (
    <section
      data-testid="mural-banner"
      aria-label="Pulso do time"
      className="relative overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low"
      onMouseEnter={() => {
        paused.current = true
      }}
      onMouseLeave={() => {
        paused.current = false
      }}
    >
      {/* barra de acento e brilho do item ativo */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 120% at 0% 0%, ${accent}1f, transparent 55%)` }}
        aria-hidden
      />

      <header className="relative flex items-center justify-between gap-md px-lg pt-md">
        <div className="flex items-center gap-sm">
          <span style={{ color: accent }}>
            <Icon name="campaign" className="text-[20px]" />
          </span>
          <span className="font-label text-label-sm font-bold uppercase tracking-[0.18em] text-on-surface-variant">
            Pulso do time
          </span>
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-sm">
            <span className="font-label text-label-sm font-bold tabular-nums" style={{ color: accent }}>
              {active + 1}/{items.length}
            </span>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                aria-label="Item anterior"
                onClick={() => go(-1)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="chevron_left" className="text-[18px]" />
              </button>
              <button
                type="button"
                aria-label="Próximo item"
                onClick={() => go(1)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="chevron_right" className="text-[18px]" />
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="relative">
        <Link
          to={itemHref(item)}
          key={`${item.type}-${item.id}`}
          aria-live="polite"
          className={`block transition-colors hover:bg-surface-container-highest/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${reduceMotion ? '' : 'mural-slide-enter'}`}
        >
          <Slide item={item} accent={accent} />
        </Link>
      </div>
    </section>
  )
}
