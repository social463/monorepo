-- Etiqueta do evento: a coluna `Tag` da planilha da G&G ("Simulado", "Circuito",
-- "Café Temático"). É mais fina que a categoria e NÃO dá cor nem filtro — quem
-- faz isso continua sendo `typeId`. Sem esta coluna, cada vocabulário novo da
-- planilha virava uma categoria: o calendário inteiro ficou da mesma cor (toda
-- categoria fora do catálogo padrão nasce com a de fallback) e a barra de
-- filtro passou de 10 para 31 chips.
ALTER TABLE "CalendarEvent" ADD COLUMN "tag" TEXT;
