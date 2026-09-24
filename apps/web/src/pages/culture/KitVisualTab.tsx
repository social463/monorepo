import { useState } from 'react'
import type { CulturePersonalAssetDTO, CultureVisualAssetDTO } from '@legends/shared'
import {
  BRAND_SCHEMES,
  CULTURE_VISUAL_ASSET_BRANDS,
  CULTURE_VISUAL_ASSET_BRAND_LABELS,
  CULTURE_VISUAL_ASSET_BRAND_RULES,
  type BrandScheme,
  type CultureVisualAssetBrand,
} from '@legends/shared'
import { useBrand } from '../../brand/BrandContext'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import {
  downloadPersonalAsset,
  useCulturePage,
  useCultureVisualAssets,
  useMyPersonalAssets,
} from '../../lib/use-culture'

const SCHEME_LABELS: Record<BrandScheme, string> = {
  light: 'Tema claro',
  dark: 'Tema escuro',
}

/**
 * Kit visual da empresa: as peças que o G&G publica, os logos e a cor institucional.
 *
 * Duas fontes de propósito, e elas não se misturam. **Logos e cores** saem do
 * branding do SUPER_ADMIN (`GET /branding`): são o que o produto já usa para se
 * pintar, e duplicá-los como peça administrável deixaria a tela discordar do
 * app. **As peças** (banner de LinkedIn, fundo de reunião, selo de campanha)
 * vêm do banco e são de quem cuida da comunicação — arte que o produto não
 * consome e que muda o tempo todo.
 */
export function KitVisualTab() {
  const brand = useBrand()
  const { data: pagina } = useCulturePage('kit-visual')
  const { data: assetsData } = useCultureVisualAssets()
  const assets = assetsData?.assets ?? []
  const { data: pessoaisData } = useMyPersonalAssets()
  const pessoais = pessoaisData?.assets ?? []
  const hasAnyLogo = BRAND_SCHEMES.some(
    (scheme) => brand.logos[scheme].wide || brand.logos[scheme].mark,
  )

  return (
    <div className="flex flex-col gap-lg">
      <p className="text-body-md text-on-surface-variant">
        Os arquivos oficiais da marca. Use sempre estes — nada de recortar de apresentação ou
        de print.
      </p>

      {/* As regras de uso, quando o G&G escreveu alguma. Antes das peças: é o
          "como usar" do que vem logo abaixo. */}
      {pagina && (
        <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <Markdown content={pagina.body} />
        </section>
      )}

      {/* O que é só desta pessoa vem ANTES do que é de todo mundo: quem abre a
          aba por causa da própria foto não deveria ter que rolar até o fim. */}
      {pessoais.length > 0 && (
        <section>
          <div className="mb-md flex items-center gap-xs">
            <h2 className="font-headline text-headline-sm text-on-surface">Seus materiais</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-sm py-[2px] font-label text-label-sm text-on-surface-variant">
              <Icon name="lock" className="text-[14px]" />
              Só você vê
            </span>
          </div>
          <div className="grid gap-lg md:grid-cols-2">
            {pessoais.map((asset) => (
              <PersonalAssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        </section>
      )}

      {assets.length > 0 && <PecasParaBaixar assets={assets} />}

      <section>
        <h2 className="mb-md font-headline text-headline-sm text-on-surface">Logos</h2>
        {!hasAnyLogo ? (
          <p className="text-body-sm text-on-surface-variant">
            Nenhum logo cadastrado ainda para {brand.appName}.
          </p>
        ) : (
          <div className="grid gap-md sm:grid-cols-2">
            {BRAND_SCHEMES.map((scheme) => (
              <div key={scheme} className="flex flex-col gap-sm rounded-2xl border border-outline-variant/40 p-lg">
                <h3 className="font-label text-label-md text-on-surface-variant">{SCHEME_LABELS[scheme]}</h3>
                {/* Fundo fixo por esquema, e não o `surface` do tema atual: um
                    logo de tema escuro sobre fundo claro some, e é justamente
                    esse o erro que o kit existe para evitar. */}
                <div
                  className={`flex items-center justify-center gap-lg rounded-xl p-lg ${
                    scheme === 'dark' ? 'bg-neutral-900' : 'bg-white'
                  }`}
                >
                  {brand.logos[scheme].wide ? (
                    <img src={brand.logos[scheme].wide!} alt={`Logo ${SCHEME_LABELS[scheme]}`} className="h-10" />
                  ) : (
                    <span className="text-body-sm text-neutral-500">Sem logo horizontal</span>
                  )}
                  {brand.logos[scheme].mark && (
                    <img src={brand.logos[scheme].mark!} alt={`Símbolo ${SCHEME_LABELS[scheme]}`} className="h-10" />
                  )}
                </div>
                <div className="flex flex-wrap gap-md">
                  {(['wide', 'mark'] as const).map((kind) => {
                    const url = brand.logos[scheme][kind]
                    if (!url) return null
                    return (
                      <a
                        key={kind}
                        href={url}
                        download
                        className="group flex items-center gap-1 font-label text-label-md text-primary"
                      >
                        <Icon name="download" className="text-[16px]" />
                        <span className="group-hover:underline">
                          {kind === 'wide' ? 'Horizontal' : 'Símbolo'}
                        </span>
                      </a>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-md font-headline text-headline-sm text-on-surface">Cor da marca</h2>
        <div className="flex flex-wrap gap-md">
          <ColorChip label="Institucional" value={brand.brandColor} />
          {brand.neutralColor && <ColorChip label="Neutra" value={brand.neutralColor} />}
        </div>
        {/* Explica a diferença que sempre gera dúvida: a cor institucional é de
            preenchimento, não de texto — ver a rampa em `branding.ts`. */}
        <p className="mt-md text-body-sm text-on-surface-variant">
          A cor institucional é para preenchimento e decoração. Em texto, a plataforma usa um tom
          mais escuro do mesmo matiz, para o contraste ficar legível.
        </p>
      </section>
    </div>
  )
}

/**
 * Card de uma peça: preview grande e o download.
 *
 * `CONTAIN` desenha sobre fundo branco fixo, e não sobre a `surface` do tema —
 * é o mesmo motivo do bloco de logos logo abaixo: peça de fundo transparente
 * feita para claro some no escuro, e o kit existe justamente para a pessoa ver
 * o arquivo como ele é. `COVER` não precisa: arte que sangra cobre o card.
 */
/**
 * As peças, separadas pelas duas identidades visuais que convivem na EMR
 * (Documento 4, seção 7).
 *
 * A regra de uso mora **dentro** da aba, acima da grade, e não em tooltip: o
 * problema relatado não foi "não dá pra achar a peça", foi a marca nova indo
 * para fora da empresa porque ninguém lembrava do combinado.
 *
 * Aba sem peça mostra estado vazio em vez de sumir. Aba que some leva a regra
 * junto — e a regra é metade do que esta separação entrega.
 */
function PecasParaBaixar({ assets }: { assets: CultureVisualAssetDTO[] }) {
  const [aba, setAba] = useState<CultureVisualAssetBrand>('CURRENT')
  const daAba = assets.filter((asset) => asset.brand === aba)

  return (
    <section>
      <h2 className="mb-md font-headline text-headline-sm text-on-surface">Peças para baixar</h2>

      <div
        role="tablist"
        aria-label="Identidade visual"
        className="mb-md flex gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
      >
        {CULTURE_VISUAL_ASSET_BRANDS.map((brand) => {
          const ativa = aba === brand
          return (
            <button
              key={brand}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(brand)}
              className={[
                'flex flex-1 items-center justify-center rounded-lg px-md py-sm font-label text-label-md transition-colors',
                ativa
                  ? 'bg-primary/10 font-bold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              {CULTURE_VISUAL_ASSET_BRAND_LABELS[brand]}
            </button>
          )
        })}
      </div>

      <p className="mb-md flex items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-low p-md text-body-sm text-on-surface-variant">
        <Icon name="info" className="mt-0.5 shrink-0 text-[18px] text-primary" />
        {CULTURE_VISUAL_ASSET_BRAND_RULES[aba]}
      </p>

      {daAba.length > 0 ? (
        <div className="grid gap-lg md:grid-cols-2">
          {daAba.map((asset) => (
            <VisualAssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma peça publicada nesta identidade ainda.
        </p>
      )}
    </section>
  )
}

function VisualAssetCard({ asset }: { asset: CultureVisualAssetDTO }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low">
      <div className={`relative h-56 overflow-hidden ${asset.fit === 'CONTAIN' ? 'bg-white' : ''}`}>
        {asset.imageUrl ? (
          <img
            src={asset.imageUrl}
            alt={asset.title}
            className={`h-full w-full ${asset.fit === 'COVER' ? 'object-cover' : 'object-contain p-lg'}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container text-body-sm text-on-surface-variant">
            Imagem indisponível
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-xs p-lg">
        <h3 className="font-label text-label-lg text-on-surface">{asset.title}</h3>
        <p className="flex-1 text-body-sm text-on-surface-variant">{asset.description}</p>
        {asset.imageUrl && (
          <a
            href={asset.imageUrl}
            download={asset.fileName}
            className="mt-sm inline-flex w-fit items-center gap-1 rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="download" className="text-[16px]" />
            Baixar
          </a>
        )}
      </div>
    </article>
  )
}

/** kB/MB no formato curto — o mesmo do card de manual. */
function tamanho(bytes: number | null): string | null {
  if (!bytes) return null
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`
}

/**
 * Card de um material pessoal.
 *
 * Diferente da peça global em dois pontos que importam: a prévia é um link
 * assinado de curta duração (não uma URL pública), e o download passa por
 * `<button>` chamando a rota autenticada — não um `<a href>`, porque o access
 * token vive só em memória e não viajaria num link. É o mesmo caminho do PDF de
 * manual interno.
 */
function PersonalAssetCard({ asset }: { asset: CulturePersonalAssetDTO }) {
  const [erro, setErro] = useState<string | null>(null)
  const [baixando, setBaixando] = useState(false)

  async function baixar() {
    setErro(null)
    setBaixando(true)
    try {
      await downloadPersonalAsset(asset.downloadPath)
    } catch {
      setErro('Não foi possível baixar agora. Tente de novo.')
    } finally {
      setBaixando(false)
    }
  }

  const detalhes = [asset.fileName, tamanho(asset.fileSize)].filter(Boolean).join(' · ')

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low">
      <div className="relative h-56 overflow-hidden bg-surface-container">
        {asset.previewUrl ? (
          <img src={asset.previewUrl} alt={asset.title} className="h-full w-full object-cover" />
        ) : (
          // Documento não tem o que mostrar, e imagem sem link assinado também
          // não — nos dois casos o ícone diz o que é, e o download continua de pé.
          <div className="flex h-full flex-col items-center justify-center gap-xs text-on-surface-variant">
            <Icon name={asset.kind === 'DOCUMENT' ? 'picture_as_pdf' : 'image'} className="text-[40px]" />
            <span className="text-body-sm">{asset.kind === 'DOCUMENT' ? 'Documento' : 'Imagem'}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-xs p-lg">
        <h3 className="font-label text-label-lg text-on-surface">{asset.title}</h3>
        {asset.description && <p className="text-body-sm text-on-surface-variant">{asset.description}</p>}
        {detalhes && <p className="text-label-sm text-on-surface-variant">{detalhes}</p>}
        {erro && (
          <p role="alert" className="text-body-sm text-error">
            {erro}
          </p>
        )}
        <button
          type="button"
          onClick={() => void baixar()}
          disabled={baixando}
          className="mt-sm inline-flex w-fit items-center gap-1 rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="download" className="text-[16px]" />
          {baixando ? 'Preparando…' : 'Baixar'}
        </button>
      </div>
    </article>
  )
}

function ColorChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-md rounded-xl border border-outline-variant/40 p-md">
      <span
        aria-hidden
        className="h-10 w-10 shrink-0 rounded-lg border border-outline-variant/40"
        style={{ backgroundColor: value }}
      />
      <div>
        <p className="font-label text-label-md text-on-surface">{label}</p>
        <p className="font-mono text-body-sm uppercase text-on-surface-variant">{value}</p>
      </div>
    </div>
  )
}
