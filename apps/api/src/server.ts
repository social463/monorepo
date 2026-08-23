import { buildApp } from './app'
import { startNudgeScheduler } from './scheduler/nudges'
import { startMeetingReminderScheduler } from './scheduler/meeting-reminders'
import { startCalendarEventReminderScheduler } from './scheduler/calendar-event-reminders'
import { startOneOnOneReminderScheduler } from './scheduler/one-on-one-reminders'

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
  })
  .catch((err) => {
    app.log.error(err)
    // Mesmo motivo do console.error em app.ts: com `logger: false`, o
    // app.log acima é no-op e a causa morre aqui. Falha de boot sem
    // mensagem nenhuma é indepurável em produção — o container sai com 1,
    // `docker logs` volta vazio e não há o que investigar.
    console.error('Falha ao subir a API:', err)
    process.exit(1)
  })
