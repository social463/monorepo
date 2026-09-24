import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CulturePersonalAssetDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { downloadPersonalAsset, useMyOnboardingKit } from '../../lib/use-culture'

/**
 * Os materiais que a pessoa recebeu na chegada — kit visual, plano de 90 dias,
 * o que mais o G&G mandar —, em destaque no perfil dela pelos primeiros 90 dias.
 *
 * O material é o MESMO que vive na aba Cultura › Kit visual, e continua lá para
 * sempre. O que esta seção resolve é a visibilidade: quem entrou semana passada
 * precisa do plano de 90 dias justamente quando ainda não sabe que existe uma
 * aba chamada "Kit visual" — e o perfil é a tela que todo mundo abre.
 *
 * Quem decide se a janela está aberta é o servidor (`active`), não uma conta de
 * data aqui: o relógio do navegador é do usuário. Fechada a janela, a resposta
 * nem traz a lista.
 *
 * Só faz sentido no PRÓPRIO perfil — o call site cuida disso, como o card de
 * férias e o termômetro de humor ao lado. Aqui não há id de pessoa nenhum: a
 * rota se recorta pelo token.
 */
export function OnboardingMaterialsCard() {
  const { data } = useMyOnboardingKit()
  if (!data?.active || data.assets.length === 0) return null

  return (
    <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <div className="mb-xs flex flex-wrap items-center gap-xs">
        <Icon name="waving_hand" className="text-[20px] text-primary" />
        <h2 className="font-headline text-headline-sm text-on-surface">Materiais da sua chegada</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-sm py-[2px] font-label text-label-sm text-on-surface-variant">
          <Icon name="lock" className="text-[14px]" />
          Só você vê
        </span>
      </div>

      {/* Diz que nada será perdido quando a seção sumir. Sem isto, o card vira
          uma contagem regressiva ameaçadora em cima de arquivo que a pessoa
          pode rebaixar quando quiser. */}
      <p className="mb-md text-body-sm text-on-surface-variant">
        Em destaque aqui por mais {data.daysLeft} {data.daysLeft === 1 ? 'dia' : 'dias'}. Depois
        disso continuam disponíveis em{' '}
        <Link to="/cultura?aba=kit-visual" className="text-primary hover:underline">
          Cultura › Kit visual
        </Link>
        .
      </p>

      <ul className="flex flex-col gap-sm">
        {data.assets.map((asset) => (
          <MaterialRow key={asset.id} asset={asset} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Uma linha, não o card grande da aba: aqui a seção divide a coluna do perfil
 * com humor, férias e selos, e uma grade de prévias empurraria o feedback —
 * que é a razão de a tela existir — para baixo da dobra.
 *
 * A prévia entra como MINIATURA dentro da linha, e não como a capa alta do card
 * da aba: com "Kit Onboarding" repetido em quatro linhas, o ícone genérico não
 * dizia qual era a assinatura de e-mail e qual era o banner — o nome do arquivo
 * era a única pista. A miniatura cabe na altura que as três linhas de texto já
 * ocupam, então a seção não cresce.
 *
 * `object-contain`, não `cover`: assinatura de e-mail é uma faixa larga, e
 * recortar o meio dela mostraria um pedaço de fundo. Aqui o ponto é reconhecer
 * o arquivo inteiro, não preencher o quadro. No celular ela encolhe: a linha
 * ainda divide a largura com o nome do arquivo e o botão de baixar.
 *
 * O download é `<button>` e não `<a href>` porque a rota exige o access token,
 * que vive só em memória e não viajaria num link. Mesmo caminho do manual.
 */
function MaterialRow({ asset }: { asset: CulturePersonalAssetDTO }) {
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
    <li className="flex items-center gap-md rounded-xl bg-surface-container p-md">
      {asset.previewUrl ? (
        <img
          src={asset.previewUrl}
          alt=""
          loading="lazy"
          className="h-12 w-14 shrink-0 rounded-lg border border-outline-variant/40 bg-surface-container-high object-contain sm:h-14 sm:w-20"
        />
      ) : (
        // Documento não tem o que mostrar, e imagem sem link assinado também
        // não (o `previewUrl` é assinado e cai junto com o storage). Nos dois
        // casos o ícone ocupa o MESMO espaço da miniatura, senão a lista
        // desalinha quando um material é PDF e o outro é imagem.
        <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant sm:h-14 sm:w-20">
          <Icon
            name={asset.kind === 'DOCUMENT' ? 'picture_as_pdf' : 'image'}
            className="text-[24px]"
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-label text-label-lg text-on-surface">{asset.title}</p>
        {asset.description && (
          <p className="truncate text-body-sm text-on-surface-variant">{asset.description}</p>
        )}
        {detalhes && <p className="truncate text-label-sm text-on-surface-variant">{detalhes}</p>}
        {erro && (
          <p role="alert" className="text-body-sm text-error">
            {erro}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void baixar()}
        disabled={baixando}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container-high disabled:text-on-surface-variant"
      >
        <Icon name="download" className="text-[16px]" />
        {baixando ? 'Preparando…' : 'Baixar'}
      </button>
    </li>
  )
}

/** kB/MB no formato curto — o mesmo do card de manual e do kit visual. */
function tamanho(bytes: number | null): string | null {
  if (!bytes) return null
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`
}
