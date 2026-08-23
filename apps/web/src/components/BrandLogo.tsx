import { useState } from 'react'
import { useBrandContext } from '../brand/BrandContext'

/**
 * Mesmas classes do `Skeleton` de `components/Skeleton.tsx`, repetidas aqui de
 * propósito: aquele arquivo importa `BrandName`/`BrandTagline` deste, e importar
 * de volta fecharia um ciclo. Duas classes duplicadas custam menos que um ciclo
 * de módulos — se a aparência do skeleton mudar lá, mude aqui também.
 */
const SKELETON = 'animate-pulse rounded-md bg-surface-container-highest'

/**
 * Logo da empresa. Substitui os `<img src="/illustration/*.png" alt="Legends">`
 * que estavam espalhados pelo app.
 *
 * `wide` é a versão horizontal (login, sidebar expandida); `mark` é o símbolo
 * quadrado (rail recolhido, header do mobile). Empresa sem logo cadastrada cai
 * na do produto — é o que faz o white label ser opcional, e não obrigatório.
 *
 * **Há duas esperas, e as duas piscam se não forem tratadas.** A primeira é o
 * `GET /branding`: até responder, o que existe é a marca do produto, e mostrá-la
 * significa exibir "Legends" e trocar pela do cliente um instante depois. A
 * segunda é o download do arquivo da logo: com a URL já em mãos, o `<img>` fica
 * vazio até os bytes chegarem. Nos dois casos entra um bloco de skeleton com a
 * altura final, então nada salta de lugar quando a arte aparece.
 *
 * O `alt` é sempre o nome da empresa: quem usa leitor de tela ouve a marca que
 * está vendo, não "Legends" cravado.
 */
export function BrandLogo({
  variant = 'wide',
  className,
  wideFallback = '/illustration/horizontal_logo.png',
}: {
  variant?: 'wide' | 'mark'
  className?: string
  /**
   * Arte do produto quando a empresa não cadastrou logo. Configurável porque o
   * login usa a versão sem margem (`horizontal_logo_trim`) e a sidebar usa a
   * com margem — a diferença é de enquadramento, não de marca.
   */
  wideFallback?: string
}) {
  const { branding, scheme, loading } = useBrandContext()
  /**
   * A arte segue o ESQUEMA em vigor, não o padrão da empresa: marca séria
   * entrega a mesma logo em tinta colorida (para fundo claro) e em branco (para
   * fundo escuro), e usar a errada some com a logo. Sem a versão do esquema
   * atual, cai na do outro — logo trocada é melhor que logo invisível só se a
   * empresa cadastrou uma só, e nesse caso ela é a que existe.
   */
  const doEsquema = branding.logos[scheme]
  const doOutro = branding.logos[scheme === 'dark' ? 'light' : 'dark']
  const own = variant === 'wide' ? (doEsquema.wide ?? doOutro.wide) : (doEsquema.mark ?? doOutro.mark)

  const src = own ?? (variant === 'wide' ? wideFallback : '/illustration/l.png')
  // Guarda a URL que terminou de carregar, e não um booleano: trocar de tema
  // troca a arte, e um booleano deixaria a nova imagem já marcada como pronta.
  const [carregada, setCarregada] = useState<string | null>(null)

  /** Placeholder com a altura final; a largura só importa em `wide`, que é fluida. */
  const espera = (
    <span
      aria-hidden
      className={`inline-block ${SKELETON} ${variant === 'wide' ? 'min-w-[8rem]' : ''} ${className ?? ''}`}
    />
  )

  // Espera 1: a marca ainda não chegou. Mostrar a do produto aqui é a piscada.
  if (loading) return espera

  /**
   * A arte do produto é clara sobre fundo escuro — no tema claro ela
   * praticamente desaparece. Como não existe versão em tinta escura, uma
   * empresa de tema claro que ainda não subiu a própria logo vê o nome escrito,
   * que ao menos é legível. Assim que ela cadastrar a logo, isto sai de cena.
   */
  if (!own && scheme === 'light') {
    return (
      <span className={`font-headline text-headline-md font-bold tracking-tight text-primary ${className ?? ''}`}>
        {variant === 'mark' ? branding.appName.trim().charAt(0).toUpperCase() : branding.appName}
      </span>
    )
  }

  // Espera 2: a URL existe, o arquivo ainda não. O `<img>` fica no DOM (é ele
  // que dispara o download) e ganha o skeleton até `onLoad`.
  const pronta = carregada === src
  return (
    <img
      src={src}
      alt={branding.appName}
      onLoad={() => setCarregada(src)}
      // Erro de rede não pode deixar o pulso girando para sempre.
      onError={() => setCarregada(src)}
      className={`${pronta ? '' : `${SKELETON} ${variant === 'wide' ? 'min-w-[8rem]' : ''}`} ${className ?? ''}`}
    />
  )
}

/**
 * Nome exibido — para os lugares que mostram a marca como texto, não como
 * imagem. Espera a marca chegar em vez de piscar "Legends" antes do nome real.
 */
export function BrandName() {
  const { branding, loading } = useBrandContext()
  if (loading) return <span aria-hidden className={`inline-block h-[1em] w-24 align-middle ${SKELETON}`} />
  return <>{branding.appName}</>
}

/** Assinatura sob o nome. Empresa pode não ter tagline; aí não renderiza nada. */
export function BrandTagline({ className }: { className?: string }) {
  const { branding, loading } = useBrandContext()
  if (loading) return <p aria-hidden className={`h-[1em] w-32 ${SKELETON} ${className ?? ''}`} />
  if (!branding.tagline) return null
  return <p className={className}>{branding.tagline}</p>
}
