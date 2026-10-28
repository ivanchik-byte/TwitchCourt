import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../../lib/api'
import { donationActions } from '../../lib/showRules'
import type { DonationPayload } from '../../lib/types'
import { useTribunalFeed } from '../../tribunal/TribunalContext'

export function DonationMonitor() {
  const { stenogram } = useTribunalFeed()
  const donationTick = stenogram.filter(entry => entry.kind === 'donation').slice(-1)[0]?.id
  const [receipts, setReceipts] = useState<DonationPayload[]>([])
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try { const journal = await apiGet<{ donations: DonationPayload[] }>('/api/donations'); setReceipts(journal.donations); setError('') }
    catch { setError('Журнал донатов недоступен.') }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh,15000)
    return () => clearInterval(timer)
  }, [refresh,donationTick])
  return <section className="desk-panel donation-monitor"><div className="panel-heading"><h2>Донаты</h2><Link to="/settings?section=donations">Правила и проверка</Link></div>{receipts.length ? <ol>{receipts.slice(-5).reverse().map(receipt => <li key={receipt.id}><div><strong>{receipt.donor}</strong><span>{receipt.amount} {receipt.currency}</span></div><span className={`receipt-action action-${receipt.action}`}>{donationActions[receipt.action] || receipt.action}</span>{receipt.message && <p>{receipt.message}</p>}<small>{receipt.note}</small></li>)}</ol> : <p>Здесь появятся донаты и результат их обработки.</p>}{error && <p className="panel-error" role="alert">{error}</p>}</section>
}
