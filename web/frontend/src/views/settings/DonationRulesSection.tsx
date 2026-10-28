import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiPostJson } from '../../lib/api'
import { useShowRules, donationActions } from '../../lib/showRules'

export function DonationRulesSection() {
  const { rules, setRules, error, saving, saved, save } = useShowRules()
  const [amount, setAmount] = useState('500')
  const [currency, setCurrency] = useState('RUB')
  const [message, setMessage] = useState('Ваша честь, это вам на взятку')
  const [phase, setPhase] = useState('testimony')
  const [preview, setPreview] = useState<{ action: string; note: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [bribeWords, setBribeWords] = useState<string | null>(null)
  if (!rules) return <p role="status">{error || 'Загружаем правила донатов…'}</p>

  return <div className="rules-workspace">
    <form className="rules-form" onSubmit={event => {
      event.preventDefault()
      void save({ witness_enabled: rules.witness_enabled, rule_currency: rules.rule_currency, default_min: rules.default_min, min_amounts: rules.min_amounts, bribe_min: rules.bribe_min, bribe_words: bribeWords === null ? rules.bribe_words : bribeWords.split(',').map(word => word.trim()).filter(Boolean), queue_min: rules.queue_min, streamer_trial_min: rules.streamer_trial_min, platinum_min: rules.platinum_min })
    }}>
      <section className="settings-panel"><div className="settings-panel-heading"><h2>Донаты и взятки</h2><Link to="/settings?section=twitch">Подключения сервисов</Link></div><p>DonationAlerts, DonatePay и Twitch Bits используют общие правила. Сумма сама по себе не гарантирует оправдание.</p>
        <h3>Участие в текущем деле</h3><label className="setting-switch"><input type="checkbox" checked={rules.witness_enabled} onChange={event => setRules({ ...rules, witness_enabled: event.target.checked })} />Приобщать обычные донаты как показания</label><p>От этой суммы сообщение становится показанием. Для неизвестной валюты используется запасной порог.</p>
        <div className="currency-grid">{['RUB','USD','EUR','BITS'].map(code => <label key={code}>{code}<input type="number" min="0" step="any" required value={rules.min_amounts[code] ?? 0} onChange={event => setRules({ ...rules, min_amounts: { ...rules.min_amounts, [code]: Number(event.target.value) } })} /></label>)}</div>
        <label>Остальные валюты<input type="number" min="0" step="any" required value={rules.default_min} onChange={event => setRules({ ...rules, default_min: Number(event.target.value) })} /></label>
      </section>
      <section className="settings-panel"><h3>Специальные действия</h3><p>Пороги ниже действуют только в выбранной валюте. Конвертации нет. Ноль отключает действие по сумме.</p>
        <label>Валюта порогов<select value={rules.rule_currency || 'RUB'} onChange={event => setRules({ ...rules, rule_currency: event.target.value })}>{['RUB','USD','EUR','BITS'].map(code => <option key={code}>{code}</option>)}</select></label>
        <div className="rules-number-grid"><label>Считать попыткой подкупа<input type="number" min="0" step="any" required value={rules.bribe_min} onChange={event => setRules({ ...rules, bribe_min: Number(event.target.value) })} /></label><label>Приоритет в очереди<input type="number" min="0" step="any" required value={rules.queue_min} onChange={event => setRules({ ...rules, queue_min: Number(event.target.value) })} /></label><label>Открыть суд над стримером<input type="number" min="0" step="any" required value={rules.streamer_trial_min} onChange={event => setRules({ ...rules, streamer_trial_min: Number(event.target.value) })} /></label><label>Суд по требованию<input type="number" min="0" step="any" required value={rules.platinum_min} onChange={event => setRules({ ...rules, platinum_min: Number(event.target.value) })} /></label></div>
        <p>Приоритет запрашивается сообщением <code>!court twitch_login причина</code>. Начало следующего дела остаётся за ведущим. Автоматический суд открывается только при свободном зале.</p>
      </section>
      <section className="settings-panel"><h3>Слова для подкупа</h3><p>Достаточно совпадения с одним словом или его частью, например «взятк». Донат должен пройти порог участия. Несколько предложений приобщаются к делу; судья выбирает реакцию.</p><label>Через запятую<input value={bribeWords ?? rules.bribe_words.join(', ')} onChange={event => setBribeWords(event.target.value)} placeholder="взятк, на лапу, подкуп" /></label><p>Сообщения после начала совещания не меняют решение. Во время репетиции донаты не влияют на учебный сценарий.</p></section>
      <div className="settings-save"><button className="primary-action" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить правила донатов'}</button>{saved && <span role="status">Сохранено</span>}{error && <span role="alert">{error}</span>}</div>
    </form>
    <aside className="settings-panel donation-simulator"><h2>Проверка доната</h2><p>Использует сохранённые правила. Не запускает суд, не добавляет людей в очередь и не пишет в историю.</p><form onSubmit={async event => {
      event.preventDefault()
      setTesting(true)
      setPreviewError('')
      const response = await apiPostJson<{ action: string; note: string }>('/api/donations/preview', { donor: 'test_viewer', amount: Number(amount), currency, message, phase })
      if (response.ok && response.data) setPreview(response.data)
      else setPreviewError('Не удалось проверить донат. Проверьте сумму и связь с сервером.')
      setTesting(false)
    }}><div className="rules-number-grid"><label>Сумма<input type="number" min="0.01" step="any" required value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Валюта<select value={currency} onChange={event => setCurrency(event.target.value)}>{['RUB','USD','EUR','BITS'].map(code => <option key={code}>{code}</option>)}</select></label></div><label>Сообщение<textarea value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={500} /></label><label>Когда приходит<select value={phase} onChange={event => setPhase(event.target.value)}><option value="idle">Между делами</option><option value="testimony">Во время показаний</option><option value="deliberation">На совещании суда</option></select></label><button className="secondary-action" disabled={testing}>{testing ? 'Проверяем…' : 'Проверить по правилам'}</button></form>{preview && <div className="simulation-result" role="status"><strong>{donationActions[preview.action] || preview.action}</strong><p>{preview.note}</p></div>}{previewError && <p role="alert">{previewError}</p>}</aside>
  </div>
}
