-- Acerta os 1:1 gravados com o fuso errado.
--
-- Até aqui, marcar um 1:1 gravava a hora digitada como se fosse UTC: o serviço
-- fazia `new Date('2026-08-12T10:30:00')`, ISO sem fuso, que o Node lê no fuso do
-- PROCESSO — São Paulo na máquina de quem desenvolve, UTC no contêiner. Em
-- produção, "10:30" virou 10:30Z e a tela (que formata no fuso do browser)
-- mostrava 07:30. O serviço agora converte de America/Sao_Paulo explicitamente
-- (`saoPauloInstant`, em `lib/sao-paulo-date.ts`); falta corrigir o que já está
-- gravado.
--
-- Sem recorte por data de propósito: TODA linha existente no instante em que esta
-- migration roda foi criada pelo código antigo. O corte é o próprio deploy — o que
-- exige rodá-la junto com o código novo, e não antes. Encontro criado entre a
-- migration e a subida do código seria corrigido duas vezes.
--
-- +3h é o offset fixo de São Paulo; o Brasil não tem horário de verão desde 2019,
-- e todos os 1:1 existentes foram criados depois disso.
UPDATE "OneOnOneMeeting"
SET "startsAt" = "startsAt" + interval '3 hours',
    "endsAt" = "endsAt" + interval '3 hours';

-- O fim da recorrência tinha o mesmo defeito: `${dia}T23:59:59` sem fuso virava
-- 23:59:59Z, que em São Paulo é 20:59 do mesmo dia. Somando 3h vira 02:59:59 do
-- dia seguinte em UTC — o fim real do dia civil de São Paulo.
UPDATE "OneOnOneSeries"
SET "recurrenceUntil" = "recurrenceUntil" + interval '3 hours'
WHERE "recurrenceUntil" IS NOT NULL;
