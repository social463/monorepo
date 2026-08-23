ALTER TABLE "Feedback"
ADD COLUMN "developmentThursdayEventId" TEXT;

CREATE INDEX "Feedback_developmentThursdayEventId_idx" ON "Feedback"("developmentThursdayEventId");

ALTER TABLE "Feedback"
ADD CONSTRAINT "Feedback_developmentThursdayEventId_fkey"
FOREIGN KEY ("developmentThursdayEventId")
REFERENCES "DevelopmentThursdayEvent"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
