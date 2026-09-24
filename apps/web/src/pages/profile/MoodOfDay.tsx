import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoodLevel, MoodReason, TodayMoodDTO } from "@legends/shared";
import {
  MOOD_OPTIONS,
  MOOD_NOTE_MAX_LENGTH,
  MOOD_REASON_LABELS,
  MOOD_REASON_REQUIRED_MESSAGE,
  MOOD_SELECTABLE_REASONS,
  MOOD_SUPPORT_MESSAGES,
  isNegativeMood,
} from "@legends/shared";
import { apiFetch } from "../../lib/api";
import { invalidateCoins } from "../../lib/use-coins";
import { invalidateXp } from "../../lib/use-xp";
import { Select } from "../../components/Select";

// Cada humor é um emoji fixo — o seletor não altera o avatar salvo.
const MOOD_EMOJI: Record<MoodLevel, string> = {
  HARD: "😞",
  LOW: "🙁",
  NEUTRAL: "😐",
  GOOD: "🙂",
  GREAT: "😄",
};

const REASON_OPTIONS = MOOD_SELECTABLE_REASONS.map((value) => ({
  value,
  label: MOOD_REASON_LABELS[value],
}));

export function MoodOfDay() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MoodLevel | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<MoodReason | null>(null);

  const todayQuery = useQuery({
    queryKey: ["mood-today"],
    queryFn: () => apiFetch<TodayMoodDTO>("/me/mood/today"),
  });

  const setMood = useMutation({
    mutationFn: (vars: { mood: MoodLevel; note?: string; reason: MoodReason | null }) =>
      apiFetch<TodayMoodDTO>("/me/mood/today", {
        method: "PUT",
        body: JSON.stringify({ mood: vars.mood, note: vars.note, reason: vars.reason }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["mood-today"], data);
      queryClient.invalidateQueries({ queryKey: ["streak"] });
      queryClient.invalidateQueries({ queryKey: ["streak-calendar"] });
      invalidateCoins(queryClient);
      invalidateXp(queryClient);
    },
    // A API recusa a segunda resposta do dia (409). Pela tela isso só acontece
    // com uma aba velha aberta desde ontem — recarregar o humor de hoje leva
    // essa aba para o estado de confirmação, em vez de deixar um botão morto.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["mood-today"] });
    },
  });

  // Some durante o load ou em erro de leitura: é conteúdo acessório.
  if (todayQuery.isLoading || !todayQuery.data) return null;

  const registered = todayQuery.data.mood;
  // Já respondeu hoje → confirmação compacta, e não um buraco na Home. A
  // seção ocupa uma coluna do topo: sumir de vez deixava a faixa de
  // boas-vindas sozinha e desproporcional na linha.
  //
  // Sem "alterar": vale a PRIMEIRA resposta do dia. Poder trocar depois de ver
  // a tela convida a corrigir o próprio humor para o que parece aceitável, e o
  // painel de clima passa a medir isso em vez do dia real.
  if (registered) {
    const option = MOOD_OPTIONS.find((entry) => entry.value === registered);
    return (
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-md">
          <header>
            <h3 className="font-headline text-body-lg font-semibold text-on-surface">
              Humor de hoje registrado
            </h3>
            {/* A frase antiga prometia confidencialidade ("seu retorno entra no
                clima do time de forma confidencial"). Ela saiu junto com a
                identificação dos comentários (Documento 3, seção 4.6): coletar
                o relato sob uma promessa que o painel não cumpre mais seria pior
                do que não coletar. */}
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Obrigado — seu retorno entra no clima do time.
            </p>
          </header>

          <div className="flex items-center gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
            <span aria-hidden className="text-3xl leading-none">
              {MOOD_EMOJI[registered]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-label text-label-lg text-on-surface">{option?.label}</p>
              {todayQuery.data.note && (
                <p className="truncate text-body-sm text-on-surface-variant">“{todayQuery.data.note}”</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // O motivo só acompanha humor negativo: trocar para "Bem" descarta a escolha
  // aqui e no servidor (ver setTodayMood). Escolher Estressado(a)/Desanimado(a)
  // é o que abre a caixa complementar — não há botão de "detalhar".
  const needsReason = selected !== null && isNegativeMood(selected);
  // Em humor negativo o motivo é obrigatório (a API também recusa sem ele); o
  // comentário segue opcional em qualquer humor.
  const missingReason = needsReason && reason === null;

  function pickMood(mood: MoodLevel) {
    setSelected(mood);
    if (!isNegativeMood(mood)) setReason(null);
  }

  function cancel() {
    setSelected(null);
    setReason(null);
    setNote("");
  }

  function submit() {
    if (!selected || missingReason) return;
    const trimmed = note.trim();
    setMood.mutate({
      mood: selected,
      note: trimmed.length > 0 ? trimmed : undefined,
      reason: needsReason ? reason : null,
    });
  }

  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-md">
        <header>
          <h3 className="font-headline text-body-lg font-semibold text-on-surface">
            Como está seu humor hoje?
          </h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Seu voto ajuda a cuidar do clima e do bem-estar do time.
          </p>
        </header>

        {/* Grade de 5 colunas iguais, e não `flex-wrap`: com larguras de rótulo
            bem diferentes ("Bem" x "Estressado(a)"), o wrap desalinhava os
            emojis entre si. */}
        <div className="grid grid-cols-5 gap-xs">
          {MOOD_OPTIONS.map((option) => {
            const active = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={active}
                disabled={setMood.isPending}
                onClick={() => pickMood(option.value)}
                // `min-w-0` no item da grade: sem ele o mínimo é o conteúdo, e
                // "Estressado(a)" — uma palavra só, sem espaço para quebrar —
                // estoura a célula e invade a vizinha.
                className={`flex min-w-0 flex-col items-center gap-xs rounded-xl border px-1 py-sm transition-colors disabled:opacity-50 ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-outline-variant/40 text-on-surface-variant hover:border-primary/60 hover:text-on-surface"
                }`}
              >
                <span aria-hidden className="text-2xl leading-none sm:text-3xl">
                  {MOOD_EMOJI[option.value]}
                </span>
                {/* Sempre visível: sem o nome sob o ícone, "😟" e "😐" ficam à
                    interpretação de quem olha, e a escala perde sentido.
                    `break-words` quebra dentro da palavra, que é o único jeito
                    de "Desanimado(a)" caber numa coluna de ~80px. */}
                {/* Peso da fonte NÃO muda com a seleção: em negrito
                    "Desanimado(a)" cresce alguns pixels, deixa de caber na
                    célula e o `break-words` parte o parêntese para a linha de
                    baixo — justo no item que a pessoa acabou de escolher. A
                    seleção já se lê pela borda, pelo fundo e pela cor. */}
                <span aria-hidden className="w-full break-words text-center font-label text-label-sm leading-tight">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          // Painel só depois da escolha: antes dela, motivo e comentário são
          // campos sem contexto. O tom acompanha o humor — em dia ruim o bloco
          // não pode parecer formulário de auditoria.
          <div
            className={`flex flex-col gap-md rounded-xl border p-md ${
              needsReason
                ? "border-error/30 bg-error-container/30"
                : "border-outline-variant/40 bg-surface-container-low"
            }`}
          >
            <p className="flex items-start gap-sm text-body-sm text-on-surface">
              <span aria-hidden className="text-xl leading-none">
                {MOOD_EMOJI[selected]}
              </span>
              {MOOD_SUPPORT_MESSAGES[selected]}
            </p>

            {needsReason && (
              <div>
                <p id="mood-reason-label" className="mb-xs font-label text-label-md text-on-surface">
                  O que melhor descreve o motivo? <span className="text-error">*</span>
                </p>
                {/* Select, e não pílulas: os rótulos vão de 12 a 45 caracteres e,
                    como pílula, quebravam em linhas irregulares. */}
                <Select
                  value={reason ?? ""}
                  onChange={(value) => setReason(value as MoodReason)}
                  ariaLabel="Motivo"
                  placeholder="Selecione uma opção…"
                  options={REASON_OPTIONS}
                  disabled={setMood.isPending}
                  className="[&>button]:py-2.5"
                />
              </div>
            )}

            <div>
              <label htmlFor="mood-note" className="mb-xs block font-label text-label-md text-on-surface">
                Comentário <span className="font-normal text-on-surface-variant">(opcional)</span>
              </label>
              {/* Dito ANTES de escrever, e não depois de enviar: quem decide o
                  que contar precisa saber quem vai ler. */}
              <p className="mb-xs text-label-sm text-on-surface-variant">
                O time de Gente e Gestão lê os comentários com o seu nome. As médias do time seguem
                agregadas.
              </p>
              <textarea
                id="mood-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={MOOD_NOTE_MAX_LENGTH}
                rows={3}
                placeholder={
                  needsReason
                    ? "Se quiser, comente a situação para podermos te apoiar…"
                    : "O que te faz sentir assim?"
                }
                className="block w-full resize-none rounded-lg border border-outline-variant/40 bg-surface-container-highest px-md py-sm font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-sm">
              {/* `status` só quando há o que dizer: um live region permanente
                  faria o leitor de tela anunciar vazio a cada render. */}
              {missingReason && (
                <p role="status" className="mr-auto font-label text-label-sm text-on-surface-variant">
                  {MOOD_REASON_REQUIRED_MESSAGE}
                </p>
              )}
              <button
                type="button"
                onClick={cancel}
                disabled={setMood.isPending}
                className="rounded-lg px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={missingReason || setMood.isPending}
                onClick={submit}
                className="rounded-lg bg-primary px-xl py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:bg-surface-container disabled:text-on-surface-variant"
              >
                Registrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
