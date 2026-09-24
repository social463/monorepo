import { useEffect } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { securityPractices, securitySemaphore, sensitiveInfo } from '../content/library'

const BLOCKS = [
  { key: 'pode', data: securitySemaphore.pode, icon: 'verified_user', tone: 'border-primary/60 bg-primary-container' },
  { key: 'validacao', data: securitySemaphore.validacao, icon: 'help', tone: 'border-outline-variant/40 bg-surface-container-low' },
  { key: 'naoPode', data: securitySemaphore.naoPode, icon: 'gpp_bad', tone: 'border-error/60 bg-error-container' },
] as const

export function InovaGuiaSegurancaPage() {
  useEffect(() => trackEvent('inova_guia_seguranca_aberta', {}), [])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Segurança"
        title="Antes de compartilhar, confira"
        description="Proteger informação é proteger confiança. Se não tiver certeza se pode compartilhar, a resposta mais segura é não compartilhar ainda."
      />

      <div className="grid gap-md lg:grid-cols-3">
        {BLOCKS.map(({ key, data, icon, tone }) => (
          <article key={key} className={`rounded-2xl border p-lg ${tone}`}>
            <Icon name={icon} className="text-[24px] text-on-surface" />
            <h2 className="mt-md font-headline text-headline-sm text-on-surface">{data.label}</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">{data.subtitle}</p>
            <ul className="mt-md space-y-sm">
              {data.items.map((i) => (
                <li key={i} className="rounded-xl border border-outline-variant/40 bg-surface p-sm text-body-sm text-on-surface-variant">
                  {i}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Informações sensíveis" title="O que exige cuidado redobrado" />
          <ul className="mt-lg space-y-sm">
            {sensitiveInfo.map((i) => (
              <li key={i.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{i.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{i.detail}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Boas práticas" title="Cinco hábitos que evitam problema" />
          <ol className="mt-lg space-y-sm">
            {securityPractices.map((p, i) => (
              <li key={p} className="flex gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-label-sm font-bold text-primary">{i + 1}</span>
                <p className="text-body-sm text-on-surface-variant">{p}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
