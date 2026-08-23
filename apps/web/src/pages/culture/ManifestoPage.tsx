import { useMemo } from 'react'
import { Markdown } from '../../components/Markdown'
import { Skeleton } from '../../components/Skeleton'
import { useCulturePage } from '../../lib/use-culture'
import { splitManifesto } from './manifesto-sections'

/**
 * Tom de cada bloco. Os três papéis de destaque do Material 3 — todos derivados
 * da cor da empresa, então a variação acompanha a marca de cada tenant em vez
 * de trazer uma paleta paralela.
 *
 * A cor entra em preenchimento (o número do bloco, a barra lateral) e em tinta
 * leve no fundo. O corpo do texto continua nos tokens de superfície: é texto
 * longo, e trocar a cor da letra a cada bloco cansa mais do que ajuda.
 */
const TONES = [
  { chip: 'bg-primary-container text-on-primary-container', bar: 'bg-primary', tint: 'bg-primary-container/20' },
  {
    chip: 'bg-secondary-container text-on-secondary-container',
    bar: 'bg-secondary',
    tint: 'bg-secondary-container/20',
  },
  {
    chip: 'bg-tertiary-container text-on-tertiary-container',
    bar: 'bg-tertiary',
    tint: 'bg-tertiary-container/20',
  },
] as const

/**
 * Manifesto cultural em página própria.
 *
 * Saiu de uma aba do hub de Cultura porque é o texto mais longo do produto e o
 * que mais se quer mandar por link — dividir a atenção com Manuais e Benefícios
 * na mesma rota não ajudava nenhum dos três.
 *
 * O conteúdo continua sendo um Markdown só, cadastrado pelo G&G: a blocagem é
 * derivada dos `##` que o texto já tem (ver `splitManifesto`), e não um formato
 * novo de edição.
 */
export function ManifestoPage() {
  const { data: page, isLoading, isError } = useCulturePage('manifesto')
  const content = useMemo(() => splitManifesto(page?.body ?? ''), [page?.body])

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      {isLoading && (
        <div className="flex flex-col gap-md">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {isError && <p className="text-body-md text-error">Erro ao carregar o manifesto.</p>}

      {!isLoading && !isError && !page && (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <h1 className="font-headline text-headline-md text-on-surface">Manifesto ainda não publicado</h1>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Assim que a liderança publicar o manifesto cultural, ele aparece aqui.
          </p>
        </div>
      )}

      {!isLoading && !isError && page && (
        <>
          {/* Abertura: título, subtítulo e a frase de efeito que abre o texto. */}
          <header className="rounded-2xl border border-primary/30 bg-primary-container/30 p-lg md:p-xl">
            <h1 className="font-headline text-headline-xl text-on-surface">{page.title}</h1>
            {page.subtitle && <p className="mt-xs text-body-lg text-on-surface-variant">{page.subtitle}</p>}
            {/* Sem seção nenhuma, a "abertura" seria o texto inteiro — aí ele
                sai no bloco de baixo, e o cabeçalho fica só com o título. */}
            {content.sections.length > 0 && content.intro && (
              <Markdown content={content.intro} className="mt-md text-body-lg" />
            )}
          </header>

          {content.sections.length === 0 ? (
            // Manifesto sem `##`: não há o que blocar, e o texto sai inteiro.
            <article className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <Markdown content={page.body} />
            </article>
          ) : (
            content.sections.map((section, index) => {
              const tone = TONES[index % TONES.length]!
              return (
                <article
                  key={`${section.title}-${index}`}
                  className={`relative overflow-hidden rounded-2xl border border-outline-variant/40 p-lg md:p-xl ${
                    // Um bloco sim, um não: com tinta em todos, o alternado some
                    // e a página vira um degradê contínuo.
                    index % 2 === 0 ? tone.tint : 'bg-surface-container-low'
                  }`}
                >
                  <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
                  <header className="mb-md flex items-center gap-md">
                    <span
                      aria-hidden
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-label text-label-lg font-bold tabular-nums ${tone.chip}`}
                    >
                      {index + 1}
                    </span>
                    <h2 className="font-headline text-headline-md text-on-surface">{section.title}</h2>
                  </header>
                  <Markdown content={section.body} />
                </article>
              )
            })
          )}
        </>
      )}
    </section>
  )
}
