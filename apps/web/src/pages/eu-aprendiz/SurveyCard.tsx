import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  APPRENTICE_SURVEY_LEARNED,
  APPRENTICE_SURVEY_LEARNED_LABELS,
  type ApprenticeSurveyLearned,
} from '@legends/shared'
import { submitApprenticeSurvey } from '../../lib/apprentice-api'

/**
 * Pesquisa de satisfação do encontro. A resposta é gravada SEM vínculo com quem
 * respondeu (ver `ApprenticeSurveyResponse`): o que fica ligado à pessoa é só o
 * recibo, que existe para não perguntar duas vezes.
 */
export function SurveyCard({ meetingId, answered }: { meetingId: string; answered: boolean }) {
  const queryClient = useQueryClient()
  const [score, setScore] = useState<number | null>(null)
  const [takeaway, setTakeaway] = useState('')
  const [improvement, setImprovement] = useState('')
  const [learned, setLearned] = useState<ApprenticeSurveyLearned | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () =>
      submitApprenticeSurvey(meetingId, {
        score: score!,
        takeaway: takeaway.trim(),
        improvement: improvement.trim(),
        learned: learned!,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] }),
    onError: (err: Error) => setError(err.message),
  })

  const ready = score !== null && takeaway.trim() !== '' && learned !== null

  return (
    <section className="flex flex-col gap-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div>
        <h3 className="font-headline text-headline-sm text-on-surface">Pesquisa de satisfação</h3>
        <p className="font-body text-body-sm text-on-surface-variant">
          A resposta é anônima: seu nome não é gravado em nenhum campo.
        </p>
      </div>

      {answered ? (
        <p className="font-label text-label-lg text-on-primary-container">
          Obrigado! Sua resposta anônima foi registrada.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-sm">
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              De 0 a 10, o quanto este encontro foi útil para você?
            </span>
            <div className="flex flex-wrap gap-xs">
              {Array.from({ length: 11 }, (_, value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={score === value}
                  onClick={() => setScore(value)}
                  className={`h-10 w-10 rounded-lg border font-label text-label-lg ${
                    score === value
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-outline-variant bg-surface text-on-surface'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              O que você leva deste encontro que consegue usar no seu setor?
            </span>
            <input
              value={takeaway}
              onChange={(event) => setTakeaway(event.target.value)}
              placeholder="Resposta obrigatória"
              className="rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              O que poderia ter sido melhor? (opcional)
            </span>
            <input
              value={improvement}
              onChange={(event) => setImprovement(event.target.value)}
              className="rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface"
            />
          </label>

          <div className="flex flex-col gap-sm">
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              Você sente que aprendeu algo novo hoje?
            </span>
            <div className="flex flex-wrap gap-xs">
              {APPRENTICE_SURVEY_LEARNED.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={learned === option}
                  onClick={() => setLearned(option)}
                  className={`rounded-full border px-lg py-sm font-label text-label-md ${
                    learned === option
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-outline-variant bg-surface text-on-surface'
                  }`}
                >
                  {APPRENTICE_SURVEY_LEARNED_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-xs">
            <button
              type="button"
              disabled={!ready || send.isPending}
              onClick={() => send.mutate()}
              className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
            >
              Enviar resposta anônima
            </button>
            {error && <p className="font-body text-body-sm text-error">{error}</p>}
          </div>
        </>
      )}
    </section>
  )
}
