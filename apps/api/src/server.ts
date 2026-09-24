import { buildApp } from './app'
import { startNudgeScheduler } from './scheduler/nudges'
import { startMeetingReminderScheduler } from './scheduler/meeting-reminders'
import { startCalendarEventReminderScheduler } from './scheduler/calendar-event-reminders'
import { startOneOnOneReminderScheduler } from './scheduler/one-on-one-reminders'
import { startScheduledPostScheduler } from './scheduler/scheduled-posts'
import { startCampaignPostScheduler } from './scheduler/campaign-posts'
import { startAutoEnrollmentScheduler } from './services/course-auto-enrollment-service'
import { startVacationDeadlineReminderScheduler } from './scheduler/vacation-deadline-reminders'

const app = buildApp()
const port = Number(process.env.PORT ?? 3333)

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    console.log(`API ouvindo em http://localhost:${port}`)
    startNudgeScheduler()
    startMeetingReminderScheduler()
    startCalendarEventReminderScheduler()
    startOneOnOneReminderScheduler()
    startScheduledPostScheduler()
    startCampaignPostScheduler()
    startAutoEnrollmentScheduler()
    startVacationDeadlineReminderScheduler()
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
