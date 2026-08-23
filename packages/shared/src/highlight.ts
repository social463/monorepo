import type { PublicUser } from "./auth";
import type { HighlightStatus } from "./enums";

/** Um destaque do mês publicado, para o histórico (hall da fama). */
export interface HighlightDTO {
  periodId: string;
  monthRef: string;
  highlightMonthRef: string;
  status: HighlightStatus;
  winner: PublicUser | null;
  winnerVotes: number | null;
  text: string | null;
  imageUrl: string | null; // caminho relativo servido sob /api (ex.: /api/highlights/2026-06.png)
}
