import { useState } from 'react'
import { toast } from 'sonner'
import { apiNote, apiPost } from '../../lib/api'

export function ModerationDesk({ user }: { user: string }) {
  const [pending, setPending] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [sent, setSent] = useState('')

  const moderate = async (action: string, secs = 0) => {
    setPending(true)
    const response = await apiPost('/api/moderate', { user, action, secs, reason: 'Решение ведущего' })
    if (response.ok) { setSent('Команда отправлена в Twitch.'); setConfirmation(false) }
    else toast.error(response.status === 409 ? 'Twitch-чат не подключён.' : apiNote(response.status))
    setPending(false)
  }

  return <details className="transcript-drawer moderation-desk"><summary>Модерация в Twitch · {user}</summary><div className="moderation-controls"><p>Настоящие действия с учётной записью зрителя.</p>{sent && <p role="status">{sent}</p>}<div><button disabled={pending} className="secondary-action" onClick={() => void moderate('timeout', 60)}>Таймаут 60 с</button><button disabled={pending} className="secondary-action" onClick={() => void moderate('pardon')}>Снять бан</button><button disabled={pending} className="secondary-action" onClick={() => setConfirmation(true)}>Бан</button></div>{confirmation && <div><span>Забанить {user}?</span><button disabled={pending} className="stop-button" onClick={() => void moderate('ban')}>Подтвердить бан</button><button className="file-text-button" onClick={() => setConfirmation(false)}>Отмена</button></div>}</div></details>
}
