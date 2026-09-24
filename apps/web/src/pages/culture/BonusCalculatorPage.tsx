import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BONUS_SCORE_MAX,
  BONUS_SCORE_MIN,
  calculateBonusByTier,
  calculateQuotas,
  DEFAULT_BONUS_PROGRAM,
  effectiveSalary,
  formatBRL,
  yearsOfService,
  type BonusEmploymentType,
  type BonusProgramSettings,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { inputCls } from '../admin/shared'

/** "2028-12-31" → "31/12/2028", por corte de string: sem `Date` e sem fuso. */
function dataBR(ymd: string): string {
  const [ano, mes, dia] = ymd.split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Legenda do valor do cargo, a mesma da calculadora original. Sem ela o campo é
 * um número solto: ninguém sabe se o próprio cargo vale 1 ou 4.
 */
const VALORES_DO_CARGO = [
  { valor: 4, cargos: 'Coordenadores, Gerentes e Heads participantes do comitê' },
  { valor: 3, cargos: 'Coordenadores, Gerentes e Heads que não participam do comitê' },
  { valor: 2, cargos: 'Supervisores, Team Leaders e Especialistas' },
  { valor: 1, cargos: 'Analistas, Assistentes, Estagiários, Auxiliares e Jovens Aprendizes' },
]

/**
 * Campo do formulário: rótulo, controle e dica.
 *
 * A dica fica FORA do `<label>`, amarrada por `aria-describedby`. Dentro dele
 * ela entrava no nome acessível do campo, e o leitor de tela anunciava
 * "Data de admissão O tempo de casa conta até 31/12/2028, o fim do ciclo" toda
 * vez que o foco chegava ali.
 */
function Campo({
  id,
  rotulo,
  dica,
  children,
}: {
  id: string
  rotulo: string
  dica?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-label text-label-sm text-on-surface-variant">
        {rotulo}
      </label>
      {children}
      {dica && (
        <div id={`${id}-dica`} className="text-label-sm text-on-surface-variant">
          {dica}
        </div>
      )}
    </div>
  )
}

/**
 * Calculadora do Todos Pelos 9 (Documento 4, seção 14).
 *
 * A conta inteira mora em `@legends/shared` (`bonus-calculator`), testada lá.
 * Aqui é só formulário e formatação — é conta sobre o salário de gente de
 * verdade, e regra de negócio dentro de componente React não tem como ser
 * testada sem montar a tela.
 *
 * **Nada é enviado ao servidor.** O salário digitado não sai do navegador: a
 * página lê os números do programa (`GET /bonus-program`) e faz a conta local.
 * Isso é o que permite ela ser de todo colaborador sem expor a folha de
 * ninguém — e é dito na tela, porque quem digita o próprio salário merece saber
 * para onde ele vai.
 */
export function BonusCalculatorPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['bonus-program'],
    queryFn: () => apiFetch<{ settings: BonusProgramSettings }>('/bonus-program'),
  })
  // Enquanto carrega, vale o padrão: a tela abre com a tabela de metas montada
  // em vez de piscar vazia, e o número real chega em seguida.
  const settings = data?.settings ?? DEFAULT_BONUS_PROGRAM

  const [employmentType, setEmploymentType] = useState<BonusEmploymentType>('CLT')
  const [admissionDate, setAdmissionDate] = useState('')
  const [salary, setSalary] = useState('')
  const [positionValue, setPositionValue] = useState('')
  const [score, setScore] = useState('')

  const conta = useMemo(() => {
    const salarioBruto = Number(salary)
    const cargo = Number(positionValue)
    const desempenho = Number(score)
    const preenchido =
      admissionDate !== '' &&
      salary !== '' &&
      positionValue !== '' &&
      score !== '' &&
      Number.isFinite(salarioBruto) &&
      Number.isFinite(cargo) &&
      Number.isFinite(desempenho)
    if (!preenchido) return null
    if (desempenho < BONUS_SCORE_MIN || desempenho > BONUS_SCORE_MAX) return null
    if (salarioBruto <= 0 || cargo < 0) return null

    const anos = yearsOfService(admissionDate, settings.deadline)
    const salarioEfetivo = effectiveSalary(salarioBruto, employmentType)
    const cotas = calculateQuotas({
      salary: salarioEfetivo,
      positionValue: cargo,
      yearsOfService: anos,
      performanceScore: desempenho,
    })
    return { anos, salarioEfetivo, cotas, faixas: calculateBonusByTier(cotas, settings) }
  }, [admissionDate, salary, positionValue, score, employmentType, settings])

  const rotuloSalario =
    employmentType === 'CLT' ? 'Salário mensal bruto (R$)' : 'Valor bruto da nota mensal (R$)'

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      {/* Cabeçalho no formato das telas de Cultura (`CultureHubPage`): título e
          subtítulo, sem seta de voltar nem o ícone em bloco das páginas de
          leitura de manual e benefício. */}
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Calculadora Todos Pelos 9</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Simule o seu bônus por cotas em cada meta de atingimento da empresa.
        </p>
      </header>

      <p className="flex items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-md text-body-sm text-on-surface-variant">
        <Icon name="lock" className="mt-0.5 shrink-0 text-[18px]" />
        <span>
          O cálculo acontece <strong className="font-label text-on-surface">no seu navegador</strong>. O
          salário que você digitar não é enviado nem guardado em lugar nenhum.
        </span>
      </p>

      {/* Na largura da página, formulário e resultado lado a lado: empilhados,
          os campos esticavam até 1600px e a simulação ficava abaixo da dobra. */}
      <div className="grid items-start gap-lg lg:grid-cols-2">
        <form
          className="grid gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg sm:grid-cols-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <fieldset className="sm:col-span-2">
            <legend className="mb-xs font-label text-label-sm text-on-surface-variant">
              Tipo de contratação
            </legend>
            <div className="flex gap-md">
              {(['CLT', 'PJ'] as const).map((tipo) => (
                <label key={tipo} className="flex items-center gap-xs text-body-md text-on-surface">
                  <input
                    type="radio"
                    name="employmentType"
                    value={tipo}
                    checked={employmentType === tipo}
                    onChange={() => setEmploymentType(tipo)}
                  />
                  {tipo}
                </label>
              ))}
            </div>
          </fieldset>

          <Campo
            id="admissao"
            rotulo="Data de admissão"
            dica={`O tempo de casa conta até ${dataBR(settings.deadline)}, o fim do ciclo.`}
          >
            <input
              id="admissao"
              aria-describedby="admissao-dica"
              type="date"
              value={admissionDate}
              onChange={(e) => setAdmissionDate(e.target.value)}
              className={inputCls}
            />
          </Campo>

          <Campo
            id="salario"
            rotulo={rotuloSalario}
            dica={
              employmentType === 'CLT'
                ? 'O 13º, o 14º e o ⅓ de férias entram diluídos na média mensal.'
                : undefined
            }
          >
            <input
              id="salario"
              aria-describedby={employmentType === 'CLT' ? 'salario-dica' : undefined}
              type="number"
              min="0"
              step="0.01"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="Ex: 5000"
              className={inputCls}
            />
          </Campo>

          <Campo
            id="cargo"
            rotulo="Valor do cargo"
            dica={
              <ul className="flex flex-col gap-0.5">
                {VALORES_DO_CARGO.map(({ valor, cargos }) => (
                  <li key={valor} className="flex gap-xs">
                    <strong className="w-3 shrink-0 font-label tabular-nums text-on-surface">{valor}</strong>
                    <span>{cargos}</span>
                  </li>
                ))}
              </ul>
            }
          >
            <input
              id="cargo"
              aria-describedby="cargo-dica"
              type="number"
              min="0"
              step="0.01"
              value={positionValue}
              onChange={(e) => setPositionValue(e.target.value)}
              placeholder="Ex: 3"
              className={inputCls}
            />
          </Campo>

          <Campo id="desempenho" rotulo={`Avaliação de desempenho (${BONUS_SCORE_MIN} a ${BONUS_SCORE_MAX})`}>
            <input
              id="desempenho"
              type="number"
              min={BONUS_SCORE_MIN}
              max={BONUS_SCORE_MAX}
              step="0.1"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="Ex: 4.5"
              className={inputCls}
            />
          </Campo>
        </form>

        {/* Sem botão "calcular": o resultado acompanha o formulário. O app
            original exigia um clique e mostrava um toast de "dados incompletos" —
            aqui a ausência do resultado já é a mensagem. */}
        {conta === null ? (
          <p className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-outline-variant/60 p-xl text-center text-body-md text-on-surface-variant">
            Preencha os quatro campos para ver a simulação.
          </p>
        ) : (
          <div className="flex flex-col gap-md">
            <div className="grid gap-md sm:grid-cols-3">
              <Numero rotulo="Tempo de casa" valor={`${conta.anos.toFixed(2)} anos`} />
              <Numero rotulo="Salário na conta" valor={formatBRL(conta.salarioEfetivo)} />
              <Numero
                rotulo="Suas cotas"
                valor={conta.cotas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-outline-variant/40">
              <table className="w-full min-w-[320px] border-collapse text-body-md">
                <caption className="sr-only">Bônus estimado por meta de atingimento</caption>
                <thead className="bg-surface-container-highest">
                  <tr>
                    <th scope="col" className="px-md py-sm text-left font-label text-label-sm text-on-surface-variant">
                      Meta atingida
                    </th>
                    <th scope="col" className="px-md py-sm text-right font-label text-label-sm text-on-surface-variant">
                      Seu bônus
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {conta.faixas.map((faixa) => {
                    const cheia = faixa === conta.faixas[conta.faixas.length - 1]
                    return (
                      <tr
                        key={faixa.percent}
                        className={`border-t border-outline-variant/30 ${cheia ? 'bg-primary/10' : ''}`}
                      >
                        <td className={`px-md py-sm ${cheia ? 'font-label font-bold text-on-surface' : 'text-on-surface'}`}>
                          {faixa.percent.toLocaleString('pt-BR')}%
                        </td>
                        <td
                          className={`px-md py-sm text-right tabular-nums ${
                            cheia ? 'font-label font-bold text-primary' : 'text-on-surface'
                          }`}
                        >
                          {formatBRL(faixa.amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-label-sm text-on-surface-variant">
              Estimativa. O valor final depende do resultado da empresa no fechamento do ciclo e do total de
              cotas apurado na data.
              {isLoading && ' Carregando os números do programa…'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-md">
      <p className="font-label text-label-sm text-on-surface-variant">{rotulo}</p>
      <p className="mt-1 font-headline text-title-md text-on-surface">{valor}</p>
    </div>
  )
}
