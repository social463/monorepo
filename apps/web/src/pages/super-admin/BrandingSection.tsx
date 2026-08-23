import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BRAND_SCHEMES,
  BrandOverridesParseError,
  EMPTY_LOGOS,
  parseBrandOverrides,
  type BrandOverrides,
  type BrandLogoSet,
  type BrandPalette,
  type BrandScheme,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  getBrandingSettings,
  previewBranding,
  updateBranding,
  uploadBrandingLogo,
} from '../../lib/branding-api'
import { UploadError } from '../../lib/upload'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from '../admin/shared'

const QUERY_KEY = ['super-admin', 'branding']

const SCHEME_LABELS: Record<BrandScheme, string> = {
  light: 'Claro',
  dark: 'Escuro',
}

/** Amostras da prévia — os tokens que dizem mais sobre a cara do produto. */
const PREVIEW_SWATCHES: Array<{ token: keyof BrandPalette; label: string }> = [
  { token: 'primary', label: 'Marca' },
  { token: 'surface-tint', label: 'Institucional' },
  { token: 'surface', label: 'Fundo' },
  { token: 'surface-container', label: 'Card' },
  { token: 'on-surface', label: 'Texto' },
  { token: 'outline', label: 'Borda' },
  { token: 'error', label: 'Erro' },
]

/**
 * Marca de uma empresa cliente — editada pelo **super admin**, no console
 * interno, e não pelo ADMIN da própria empresa: num produto white label a
 * identidade faz parte do que o fornecedor entrega.
 *
 * A empresa cadastra **uma** cor e o servidor deriva os 35 tokens Material 3.
 * Não há campo por token de propósito — paleta de 35 hex preenchida à mão sai
 * quebrada, e o mais provável é sair ilegível: o verde institucional da EMR,
 * por exemplo, rende 2.3:1 como texto, bem abaixo do mínimo de 4.5:1.
 *
 * A prévia vem da API, e não de uma derivação local, para que o que se vê aqui
 * seja exatamente a paleta que o servidor vai resolver — inclusive para o card
 * do Destaque do Mês e o certificado, que são renderizados lá.
 */
export function BrandingSection({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const settings = useQuery({
    queryKey: [...QUERY_KEY, companyId],
    queryFn: () => getBrandingSettings(companyId),
  })
  const uploadsEnabled = useImageUploadsEnabled()

  const [message, setMessage] = useState<string | null>(null)
  const [appName, setAppName] = useState('')
  const [tagline, setTagline] = useState('')
  const [defaultScheme, setDefaultScheme] = useState<BrandScheme>('dark')
  const [allowUserScheme, setAllowUserScheme] = useState(false)
  /** Qual esquema a prévia está mostrando — não é o que se salva. */
  const [previewScheme, setPreviewScheme] = useState<BrandScheme>('dark')
  const [brandColor, setBrandColor] = useState('#52fba2')
  const [neutralColor, setNeutralColor] = useState('')
  const [hosts, setHosts] = useState('')
  const [overrides, setOverrides] = useState<BrandOverrides>({})
  const [tokensJson, setTokensJson] = useState('')
  const [tokensAviso, setTokensAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [logos, setLogos] = useState<BrandLogoSet>(EMPTY_LOGOS)
  const [uploading, setUploading] = useState<string | null>(null)

  // Hidrata uma vez só: revalidação não pode pisar no que o admin está editando.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!settings.data || hydratedRef.current) return
    hydratedRef.current = true
    const d = settings.data
    setAppName(d.appName)
    setTagline(d.tagline ?? '')
    setDefaultScheme(d.defaultScheme)
    setAllowUserScheme(d.allowUserScheme)
    setPreviewScheme(d.defaultScheme)
    setBrandColor(d.brandColor)
    setNeutralColor(d.neutralColor ?? '')
    setHosts(d.hosts.join('\n'))
    setOverrides(d.overrides)
    setLogos(d.logos)
  }, [settings.data])

  const preview = useQuery({
    // Os overrides entram na chave: colar tokens tem que repintar a prévia.
    queryKey: ['super-admin', 'branding', 'preview', brandColor, neutralColor, JSON.stringify(overrides)],
    queryFn: () => previewBranding({ brandColor, neutralColor: neutralColor || null, overrides }),
    // Só consulta com hex completo — o input de texto passa por estados inválidos ("#3", "#35b").
    enabled: /^#[0-9a-fA-F]{6}$/.test(brandColor) && (neutralColor === '' || /^#[0-9a-fA-F]{6}$/.test(neutralColor)),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: () =>
      updateBranding(companyId, {
        appName: appName.trim(),
        tagline: tagline.trim() || null,
        hosts: hosts
          .split(/[\n,;]+/)
          .map((h) => h.trim())
          .filter(Boolean),
        logos,
        defaultScheme,
        allowUserScheme,
        brandColor,
        neutralColor: neutralColor || null,
        overrides,
      }),
    onSuccess: () => {
      setMessage('Marca salva. Quem é da empresa vê a mudança no próximo carregamento.')
      // Sem `applyBranding` aqui, de propósito: quem edita é o super admin, e o
      // console interno tem marca própria. Repintar a tela dele com as cores do
      // cliente seria mentira — a prévia abaixo é onde o resultado se vê.
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar a marca.'),
  })

  async function handleLogo(esquema: BrandScheme, variant: 'wide' | 'mark', file: File | undefined) {
    if (!file) return
    const chave = `${esquema}-${variant}`
    setMessage(null)
    setUploading(chave)
    try {
      const url = await uploadBrandingLogo(companyId, file)
      setLogos((atual) => ({ ...atual, [esquema]: { ...atual[esquema], [variant]: url } }))
    } catch (err) {
      setMessage(err instanceof UploadError || err instanceof ApiError ? err.message : 'Erro ao subir a logo.')
    } finally {
      setUploading(null)
    }
  }

  function limparLogo(esquema: BrandScheme, variant: 'wide' | 'mark') {
    setLogos((atual) => ({ ...atual, [esquema]: { ...atual[esquema], [variant]: null } }))
  }

  function aplicarTokens() {
    setTokensAviso(null)
    try {
      const r = parseBrandOverrides(tokensJson)
      setOverrides(r.overrides)
      const partes = [`${r.applied.light} tokens no claro, ${r.applied.dark} no escuro.`]
      // Reportado, não engolido: quem colou precisa saber o que ficou de fora.
      if (r.unknownTokens.length) partes.push(`Ignorados (token desconhecido): ${r.unknownTokens.join(', ')}.`)
      if (r.invalidColors.length) partes.push(`Ignorados (cor inválida): ${r.invalidColors.join(', ')}.`)
      setTokensAviso({ tom: r.unknownTokens.length || r.invalidColors.length ? 'erro' : 'ok', texto: partes.join(' ') })
      setTokensJson('')
    } catch (err) {
      setTokensAviso({
        tom: 'erro',
        texto: err instanceof BrandOverridesParseError ? err.message : 'Não foi possível ler o JSON.',
      })
    }
  }

  function limparTokens() {
    setOverrides({})
    setTokensAviso({ tom: 'ok', texto: 'Ajustes removidos. A paleta volta a ser derivada da cor da marca.' })
  }

  const totalOverrides =
    Object.keys(overrides.light ?? {}).length + Object.keys(overrides.dark ?? {}).length

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    save.mutate()
  }

  const colors = preview.data?.schemes[previewScheme]
  const issues = preview.data?.contrastIssues[previewScheme] ?? []
  // Um esquema pode passar e o outro não; o aviso do modo oculto não pode sumir.
  const outroEsquema: BrandScheme = previewScheme === 'dark' ? 'light' : 'dark'
  const issuesOutro = preview.data?.contrastIssues[outroEsquema] ?? []

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Marca da empresa">
        <p className="mb-lg max-w-2xl text-body-sm text-on-surface-variant">
          Nome, logo e cores que todo mundo da empresa enxerga. A partir da cor da marca, o sistema
          monta a paleta inteira e confere a legibilidade de cada combinação.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
          <div className="grid gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Nome exibido
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                maxLength={60}
                required
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Assinatura (opcional)
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={120}
                placeholder="Onde as lendas nascem"
                className={inputCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Domínios da empresa
            <textarea
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
              rows={2}
              placeholder="legends.suaempresa.com.br"
              className={inputCls}
            />
            <span className="text-[11px] text-on-surface-variant">
              Um por linha. Quem abrir por um destes endereços vê esta marca já na tela de login —
              sem precisar de subdomínio. Em branco, a empresa é alcançada por
              <code className="mx-1">{'<slug>'}.{'<domínio do app>'}</code>.
            </span>
          </label>

          <div className="grid gap-md sm:grid-cols-3">
            <ColorField
              label="Cor da marca"
              hint="A cor institucional da empresa."
              value={brandColor}
              onChange={setBrandColor}
            />
            <ColorField
              label="Tom neutro (opcional)"
              hint="Matiz dos fundos e bordas. Vazio: a própria marca tinge."
              value={neutralColor}
              onChange={setNeutralColor}
              allowEmpty
            />
            {/* `role=group` e não `<label>`: um label envolvendo dois botões vira o
                nome acessível dos dois, e o leitor de tela anuncia "Esquema Claro
                Escuro" nas duas opções. */}
            <div
              role="group"
              aria-label="Esquema de cores"
              className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant"
            >
              <span>Esquema padrão</span>
              <div className="flex gap-sm">
                {BRAND_SCHEMES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setDefaultScheme(option)
                      setPreviewScheme(option)
                    }}
                    aria-pressed={defaultScheme === option}
                    className={`flex-1 rounded-md border px-3 py-2 font-label text-label-md transition-colors ${
                      defaultScheme === option
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/60 text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {SCHEME_LABELS[option]}
                  </button>
                ))}
              </div>
              <label className="mt-1 flex items-center gap-sm text-[11px] text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={allowUserScheme}
                  onChange={(e) => setAllowUserScheme(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Deixar cada pessoa alternar
              </label>
            </div>
          </div>

          {/*
              Quatro campos, e não dois: a mesma arte precisa de tinta colorida
              para fundo claro e branca para fundo escuro. Uma logo branca num
              tema claro simplesmente some.
          */}
          {BRAND_SCHEMES.map((esquema) => (
            <div key={esquema} className="grid gap-md sm:grid-cols-2">
              <LogoField
                label={`Logo horizontal — tema ${SCHEME_LABELS[esquema].toLowerCase()}`}
                hint="Login e barra lateral."
                url={logos[esquema].wide}
                dark={esquema === 'dark'}
                busy={uploading === `${esquema}-wide`}
                disabled={!uploadsEnabled}
                onPick={(file) => handleLogo(esquema, 'wide', file)}
                onClear={() => limparLogo(esquema, 'wide')}
              />
              <LogoField
                label={`Símbolo — tema ${SCHEME_LABELS[esquema].toLowerCase()}`}
                hint="Menu recolhido, favicon e app instalado."
                url={logos[esquema].mark}
                dark={esquema === 'dark'}
                busy={uploading === `${esquema}-mark`}
                disabled={!uploadsEnabled}
                onPick={(file) => handleLogo(esquema, 'mark', file)}
                onClear={() => limparLogo(esquema, 'mark')}
              />
            </div>
          ))}

          {!uploadsEnabled && (
            <p className="text-body-sm text-on-surface-variant">
              Upload de imagem está desligado neste ambiente — sem S3 configurado, a empresa fica com
              a arte padrão.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-md">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90 disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {save.isPending ? 'Salvando…' : 'Salvar marca'}
            </button>
            {settings.data && !settings.data.configured && (
              <span className="text-body-sm text-on-surface-variant">
                Ainda usando a identidade padrão do produto.
              </span>
            )}
          </div>

          {message && (
            <p role="status" className="text-body-sm text-on-surface">
              {message}
            </p>
          )}
        </form>
      </Panel>

      {/*
          Painel separado, e depois do formulário: é o caminho do cliente que
          TEM design system próprio — a minoria. Quem não tem informa uma cor e
          nunca precisa abrir isto.
      */}
      <Panel
        title="Tokens do design system"
        action={
          totalOverrides > 0 ? (
            <span className="font-label text-label-sm text-on-surface-variant">
              {totalOverrides} {totalOverrides === 1 ? 'token fixado' : 'tokens fixados'}
            </span>
          ) : undefined
        }
      >
        <p className="mb-md max-w-2xl text-body-sm text-on-surface-variant">
          A paleta acima é derivada da cor da marca. Se a empresa tem um design system próprio, cole
          aqui os valores exatos — eles vencem a derivação, token a token. O que não for colado
          continua derivado.
        </p>
        <textarea
          value={tokensJson}
          onChange={(e) => setTokensJson(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'{\n  "light": { "primary": "#007344", "surface": "#ffffff" },\n  "dark":  { "primary": "#25de88" }\n}'}
          className={`${inputCls} font-mono text-[12px]`}
        />
        <div className="mt-md flex flex-wrap items-center gap-md">
          <button
            type="button"
            onClick={aplicarTokens}
            disabled={!tokensJson.trim()}
            className="rounded-md border border-outline-variant px-lg py-2 font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            Aplicar tokens
          </button>
          {totalOverrides > 0 && (
            <button
              type="button"
              onClick={limparTokens}
              className="rounded-md px-md py-2 font-label text-label-md text-on-surface-variant transition-colors hover:text-error"
            >
              Voltar para a paleta derivada
            </button>
          )}
          <span className="text-[11px] text-on-surface-variant">
            Aplicar só muda a prévia — salvar é o botão do formulário acima.
          </span>
        </div>
        {tokensAviso && (
          <p
            role="status"
            className={`mt-md text-body-sm ${tokensAviso.tom === 'erro' ? 'text-error' : 'text-on-surface'}`}
          >
            {tokensAviso.texto}
          </p>
        )}
      </Panel>

      <Panel
        title="Prévia da paleta"
        action={
          <div className="flex gap-sm" role="group" aria-label="Esquema da prévia">
            {BRAND_SCHEMES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPreviewScheme(option)}
                aria-pressed={previewScheme === option}
                className={`rounded-md border px-3 py-1.5 font-label text-label-sm transition-colors ${
                  previewScheme === option
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/60 text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {SCHEME_LABELS[option]}
              </button>
            ))}
          </div>
        }
      >
        {issues.length > 0 && (
          <div
            role="alert"
            className="mb-lg rounded-md border border-error/40 bg-error-container/20 p-md text-body-sm text-on-surface"
          >
            <p className="mb-sm flex items-center gap-2 font-bold">
              <Icon name="warning" className="text-error" />
              Combinações difíceis de ler com esta cor
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-lg">
              {issues.map((issue) => (
                <li key={`${issue.foreground}-${issue.background}`}>
                  {issue.label}: {issue.ratio}:1 — o mínimo é {issue.min}:1.
                </li>
              ))}
            </ul>
            <p className="mt-sm text-on-surface-variant">
              Dá para salvar assim mesmo — a marca é da empresa. Mas parte do texto vai ficar difícil
              de ler para quem enxerga pouco.
            </p>
          </div>
        )}

        {issuesOutro.length > 0 && (
          <p role="alert" className="mb-lg text-body-sm text-on-surface-variant">
            O tema {SCHEME_LABELS[outroEsquema].toLowerCase()} tem {issuesOutro.length}{' '}
            {issuesOutro.length === 1 ? 'combinação difícil' : 'combinações difíceis'} de ler. Troque a
            prévia para ver quais.
          </p>
        )}

        {colors ? (
          <>
            <div className="flex flex-wrap gap-md">
              {PREVIEW_SWATCHES.map(({ token, label }) => (
                <div key={token} className="flex flex-col items-center gap-1">
                  <span
                    className="h-14 w-14 rounded-lg border border-outline-variant/40"
                    style={{ backgroundColor: colors[token] }}
                    aria-hidden
                  />
                  <span className="font-label text-label-sm text-on-surface-variant">{label}</span>
                  <code className="text-[10px] text-on-surface-variant">{colors[token]}</code>
                </div>
              ))}
            </div>

            {/* Amostra de tela, nas cores da empresa e independente do tema atual do admin. */}
            <div
              className="mt-lg rounded-xl border p-lg"
              style={{ backgroundColor: colors.surface, borderColor: colors['outline-variant'] }}
            >
              <p className="font-headline text-headline-sm" style={{ color: colors['on-surface'] }}>
                {appName || 'Nome da empresa'}
              </p>
              <p className="mt-1 text-body-sm" style={{ color: colors['on-surface-variant'] }}>
                {tagline || 'Assinatura da empresa'}
              </p>
              <div className="mt-md flex flex-wrap items-center gap-sm">
                <span
                  className="rounded-md px-md py-2 font-label text-label-md font-bold"
                  style={{ backgroundColor: colors.primary, color: colors['on-primary'] }}
                >
                  Botão principal
                </span>
                <span
                  className="rounded-md px-md py-2 font-label text-label-md"
                  style={{ backgroundColor: colors['primary-container'], color: colors['on-primary-container'] }}
                >
                  Realce
                </span>
                <span className="font-label text-label-md" style={{ color: colors.primary }}>
                  Link de texto
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            Informe uma cor em hexadecimal (ex.: #35bd78) para ver a paleta.
          </p>
        )}
      </Panel>
    </div>
  )
}

function ColorField({
  label,
  hint,
  value,
  onChange,
  allowEmpty = false,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  allowEmpty?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
      {label}
      <div className="flex items-center gap-sm">
        <input
          type="color"
          // `<input type=color>` não aceita vazio; sem tom neutro escolhido, mostra branco.
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} — seletor`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-outline-variant/60 bg-surface-container-highest"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowEmpty ? 'padrão' : '#35bd78'}
          className={inputCls}
        />
      </div>
      <span className="text-[11px] text-on-surface-variant">{hint}</span>
    </label>
  )
}

function LogoField({
  label,
  hint,
  url,
  dark,
  busy,
  disabled,
  onPick,
  onClear,
}: {
  label: string
  hint: string
  url: string | null
  /** Prévia sobre fundo escuro — logo branca sobre branco não se vê. */
  dark: boolean
  busy: boolean
  disabled: boolean
  onPick: (file: File | undefined) => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
      <span>{label}</span>
      <div
        className="flex items-center gap-md rounded-md border border-outline-variant/60 p-md"
        style={dark ? { backgroundColor: '#1d2224' } : { backgroundColor: '#ffffff' }}
      >
        {url ? (
          <img src={url} alt={`${label} atual`} className="h-10 w-auto max-w-[120px] object-contain" />
        ) : (
          <span className="text-body-sm text-on-surface-variant">Arte padrão</span>
        )}
        <div className="ml-auto flex items-center gap-sm">
          <label className="cursor-pointer rounded-md border border-outline-variant/60 px-3 py-1.5 text-label-sm text-on-surface hover:bg-surface-container-high">
            {busy ? 'Enviando…' : 'Trocar'}
            <input
              type="file"
              accept="image/svg+xml,image/png,image/webp,image/jpeg,image/gif"
              disabled={disabled || busy}
              onChange={(e) => onPick(e.target.files?.[0])}
              className="hidden"
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1.5 text-label-sm text-on-surface-variant hover:text-error"
            >
              Remover
            </button>
          )}
        </div>
      </div>
      <span className="text-[11px] text-on-surface-variant">{hint}</span>
    </div>
  )
}
