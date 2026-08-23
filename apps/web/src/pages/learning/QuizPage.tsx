import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { QuizAttemptResultDTO, SubmitQuizAttemptRequest } from '@legends/shared'
import { BackButton } from '../../components/BackButton'
import { Skeleton } from '../../components/Skeleton'
import { ApiError } from '../../lib/api'
import { getQuizForRespondent, submitQuizAttempt } from '../../lib/learning-api'

/**
 * Tentativas restantes. Antes, o rótulo pré-envio caía em `maxAttempts` (o
 * TETO) porque o DTO não trazia histórico nenhum: quem tinha usado 2 de 3 e
 * recarregava a página lia, por escrito, que tinha 3 restantes — e levava um
 * 409 ao enviar. Agora `QuizForRespondentDTO.attemptsLeft` vem do servidor já
 * descontando as tentativas usadas, e `lastResult.attemptsLeft` (exato, da
 * tentativa recém-enviada) tem precedência depois do primeiro envio da sessão.
 */
function attemptsLabel(maxAttempts: number | null, attemptsLeft: number | null): string {
  if (maxAttempts == null) return 'Tentativas ilimitadas.'
  const left = attemptsLeft ?? maxAttempts
  const tentativas = maxAttempts === 1 ? 'tentativa' : 'tentativas'
  const restantes = left === 1 ? 'restante' : 'restantes'
  return `${left} de ${maxAttempts} ${tentativas} ${restantes}.`
}

export function QuizPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [lastResult, setLastResult] = useState<QuizAttemptResultDTO | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['learning', 'quiz', id],
    queryFn: () => getQuizForRespondent(id),
    enabled: Boolean(id),
  })
  const quiz = data?.quiz

  const submit = useMutation({
    // Um reenvio que falha (ex.: 409 por limite de tentativas) não apaga o
    // resultado de uma tentativa anterior bem-sucedida — só o banner de erro
    // aparece por cima.
    mutationFn: (variables: SubmitQuizAttemptRequest) => submitQuizAttempt(id, variables),
    onSuccess: (response) => setLastResult(response.result),
  })

  function selectAnswer(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quiz) return
    const payload: SubmitQuizAttemptRequest = {
      answers: quiz.questions
        .filter((question) => answers[question.id])
        .map((question) => ({ questionId: question.id, optionId: answers[question.id] })),
    }
    submit.mutate(payload)
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-lg p-lg md:p-xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </section>
    )
  }

  if (isError || !quiz) {
    // Deliberado: a mensagem vem sempre do servidor, nunca de um texto fixo
    // por status. Hoje quem não está inscrito recebe 404 (mesma resposta de
    // "quiz inexistente" — nunca vaza a existência); se isso virar um 409
    // mais amigável no futuro, esta tela não precisa mudar.
    const message = error instanceof ApiError ? error.message : 'Não foi possível carregar o quiz.'
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-md p-lg md:p-xl">
        <BackButton />
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <h1 className="font-headline text-headline-md text-on-surface">Não foi possível abrir o quiz</h1>
          <p className="mt-sm text-body-md text-on-surface-variant">{message}</p>
        </div>
      </section>
    )
  }

  const submitError = submit.isError
    ? submit.error instanceof ApiError
      ? submit.error.message
      : 'Não foi possível enviar suas respostas.'
    : null

  const feedbackByQuestionId = new Map((lastResult?.feedback ?? []).map((item) => [item.questionId, item]))

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-lg p-lg md:p-xl">
      <BackButton />

      <header className="flex flex-col gap-xs rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
        <h1 className="font-headline text-headline-lg text-on-surface">{quiz.title}</h1>
        <p className="text-body-sm text-on-surface-variant">Nota mínima para aprovação: {quiz.passingScore}%</p>
        <p className="text-body-sm text-on-surface-variant">
          {attemptsLabel(quiz.maxAttempts, lastResult?.attemptsLeft ?? quiz.attemptsLeft)}
        </p>
      </header>

      {lastResult && (
        <section
          aria-label="Resultado da tentativa"
          className={`flex flex-col gap-xs rounded-xl border p-lg ${
            lastResult.passed ? 'border-primary/40 bg-primary/10' : 'border-error/40 bg-error/10'
          }`}
        >
          <p className="font-headline text-title-lg text-on-surface">{lastResult.passed ? 'Aprovado' : 'Reprovado'}</p>
          <p className="text-body-sm text-on-surface-variant">Nota: {lastResult.score}%</p>
          <p className="text-body-sm text-on-surface-variant">Tentativa nº {lastResult.attemptNumber}</p>
        </section>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
        {quiz.questions.map((question, index) => {
          const feedback = feedbackByQuestionId.get(question.id)
          return (
            <fieldset
              key={question.id}
              className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
            >
              <legend className="font-label text-label-md text-on-surface">
                <span className="mr-1 text-on-surface-variant">{index + 1}.</span>
                <span>{question.statement}</span>
              </legend>
              <div className="flex flex-col gap-xs">
                {question.options.map((option) => (
                  <label key={option.id} className="flex items-center gap-sm text-body-md text-on-surface">
                    <input
                      type="radio"
                      name={`question-${question.id}`}
                      value={option.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => selectAnswer(question.id, option.id)}
                      aria-label={option.text}
                    />
                    <span>{option.text}</span>
                  </label>
                ))}
              </div>
              {feedback && (
                <p className={`text-body-sm ${feedback.correct ? 'text-primary' : 'text-error'}`}>
                  {feedback.correct ? 'Resposta correta' : 'Resposta incorreta'}
                </p>
              )}
              {feedback?.explanation && <p className="text-body-sm text-on-surface-variant">{feedback.explanation}</p>}
            </fieldset>
          )
        })}

        {submitError && (
          <p role="alert" className="text-body-md text-error">
            {submitError}
          </p>
        )}

        {/*
          O botão nunca some, nem quando o limite de tentativas já foi
          esgotado: o erro 409 do servidor aparece no banner acima e explica o
          motivo — esconder o controle sem dizer por quê é pior do que deixar
          a pessoa tentar e ler a mensagem real.
        */}
        <button
          type="submit"
          disabled={submit.isPending}
          className="w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {lastResult ? 'Enviar novamente' : 'Enviar respostas'}
        </button>
      </form>
    </section>
  )
}
