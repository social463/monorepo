import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chip } from '../components/Chip'
import { SectionHeading } from '../components/SectionHeading'
import { faqCategories, faqs } from '../content/faqs'
import { convictions, glossary, microcopy, principles } from '../content/library'
import { cx } from '../lib/cx'

export function InovaGuiaCompletoPage() {
  // `?faq=<id>` vem da busca global: a pergunta já abre e rola até a vista.
  // É efeito, e não só o valor inicial, porque escolher outra FAQ na busca com
  // esta tela aberta troca a URL sem remontar a página.
  const [searchParams] = useSearchParams()
  const faqParam = searchParams.get('faq')
  const [category, setCategory] = useState('todas')
  const [open, setOpen] = useState<string | null>(faqParam)
  const openRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!faqParam) return
    setCategory('todas')
    setOpen(faqParam)
  }, [faqParam])

  useEffect(() => {
    if (faqParam && open === faqParam) openRef.current?.scrollIntoView?.({ block: 'center' })
  }, [faqParam, open])
  const visible = faqs.filter((f) => category === 'todas' || f.category === category)

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Guia AI First"
        title="Por que isso importa e como pensamos"
        description="As convicções que sustentam a cultura, os princípios que guiam o uso e as respostas para as dúvidas que todo mundo tem."
      />

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Convicções" title="No que acreditamos" />
          <ul className="mt-lg space-y-sm">
            {convictions.map((c) => (
              <li key={c.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{c.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{c.detail}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Princípios" title="Como usamos IA" />
          <ul className="mt-lg space-y-sm">
            {principles.map((p) => (
              <li key={p.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{p.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{p.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section>
        <SectionHeading
          eyebrow="Perguntas honestas"
          title="As dúvidas que aparecem de verdade"
          description="Sem rodeios: carreira, confiança na IA, uso diário, segurança, ética e aprendizado."
        />
        <div className="mt-lg flex flex-wrap gap-xs">
          <Chip active={category === 'todas'} onClick={() => setCategory('todas')}>
            Todas
          </Chip>
          {faqCategories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <ul className="mt-lg space-y-sm">
          {visible.map((f) => {
            const isOpen = open === f.id
            return (
              <li key={f.id} ref={isOpen ? openRef : undefined} className={cx('rounded-2xl border bg-surface-container-low', isOpen ? 'border-primary' : 'border-outline-variant/40')}>
                <button type="button" onClick={() => setOpen(isOpen ? null : f.id)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-md p-lg text-left">
                  <span className="font-label text-label-md font-bold text-on-surface">{f.question}</span>
                  <span className="shrink-0 text-on-surface-variant">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen ? (
                  <div className="space-y-sm border-t border-outline-variant/40 p-lg text-body-md text-on-surface-variant">
                    {f.answer.map((a, i) => (
                      <p key={i}>{a}</p>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Glossário" title="Palavras que você vai ouvir" />
          <dl className="mt-lg space-y-sm">
            {glossary.map((g) => (
              <div key={g.term} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <dt className="font-label text-label-md font-bold text-on-surface">{g.term}</dt>
                <dd className="mt-1 text-body-sm text-on-surface-variant">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <SectionHeading eyebrow="Para levar" title="Frases que resumem a cultura" />
          <ul className="mt-lg flex flex-wrap gap-xs">
            {microcopy.map((m) => (
              <li key={m} className="rounded-full border border-outline-variant/60 bg-surface-container-low px-lg py-sm text-label-md text-on-surface">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
