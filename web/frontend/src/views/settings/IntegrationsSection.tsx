import { memo } from 'react'
import { HelpTip } from '../../components/HelpTip'
import { apiPut } from '../../lib/api'
import { SecretField } from '../../components/SecretField'
import { inputCls, labelCls, saveSection, SaveButton, type TwitchState } from './shared'

interface Props {
  twitch: TwitchState
  setTwitch: (v: TwitchState) => void
  has: Record<string, boolean>
}

export const IntegrationsSection = memo(function IntegrationsSection({ twitch, setTwitch, has }: Props) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Подключения</h2><p className="settings-note">Для чата нужны канал, ник и OAuth-токен аккаунта бота. Донат-сервисы подключаются отдельно. Пустые поля токенов сохраняют прежние значения; отметка «задан» не подтверждает соединение.</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className={labelCls}>
          Канал
          <input value={twitch.channel} onChange={(e) => setTwitch({ ...twitch, channel: e.target.value })} className={inputCls} />
        </label>
        <label className={labelCls}>
          Ник бота
          <input value={twitch.nick} onChange={(e) => setTwitch({ ...twitch, nick: e.target.value })} className={inputCls} />
        </label>
      </div>
      <SecretField label={`Twitch OAuth${has.twitch_token ? ' · задан' : ''}`} help={<HelpTip label="Twitch OAuth">Токен того аккаунта, чей ник указан у бота. Для чтения и отправки сообщений нужны права chat:read и chat:edit. Для наказаний бот должен быть модератором канала; операции Helix требуют дополнительных прав.</HelpTip>} value={twitch.token} onChange={(v) => setTwitch({ ...twitch, token: v })} />
      <SecretField label="Twitch Client ID" help={<HelpTip label="Twitch Client ID">Идентификатор приложения из Twitch Developer Console. Нужен для запросов Helix, например разбана. Это отдельное значение, не OAuth-токен.</HelpTip>} value={twitch.clientId} onChange={(v) => setTwitch({ ...twitch, clientId: v })} />
      <SecretField label="ID стримера (для разбанов)" value={twitch.broadcasterId} onChange={(v) => setTwitch({ ...twitch, broadcasterId: v })} />
      <SecretField label="ID модератора (по умолчанию равен ID стримера)" value={twitch.moderatorId} onChange={(v) => setTwitch({ ...twitch, moderatorId: v })} />
      <SecretField label={`DonationAlerts токен${has.donationalerts_token ? ' · задан' : ''}`} help={<HelpTip label="DonationAlerts">Токен виджета оповещений DonationAlerts: значение после ?token= в ссылке виджета. Вставляйте сам токен, а не всю ссылку. Это не OAuth-ключ языковой модели.</HelpTip>} value={twitch.daToken} onChange={(v) => setTwitch({ ...twitch, daToken: v })} />
      <SecretField label={`DonatePay ключ${has.donatepay_key ? ' · задан' : ''}`} help={<HelpTip label="DonatePay">API-ключ аккаунта DonatePay. После подключения проверьте доставку пробного события; правила взяток и очереди находятся в разделе «Донаты».</HelpTip>} value={twitch.dpKey} onChange={(v) => setTwitch({ ...twitch, dpKey: v })} />
      <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={twitch.daEnabled} onChange={(e) => setTwitch({ ...twitch, daEnabled: e.target.checked })} />
          DonationAlerts
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={twitch.dpEnabled} onChange={(e) => setTwitch({ ...twitch, dpEnabled: e.target.checked })} />
          DonatePay
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={twitch.bitsEnabled} onChange={(e) => setTwitch({ ...twitch, bitsEnabled: e.target.checked })} />
          Twitch Bits
        </label>
      </div>
      <div>
        <SaveButton
          onSave={() =>
            saveSection('Интеграции', () =>
              apiPut('/api/integrations', {
                channel: twitch.channel,
                nick: twitch.nick,
                ...(twitch.token ? { twitch_token: twitch.token } : {}),
                ...(twitch.clientId ? { client_id: twitch.clientId } : {}),
                ...(twitch.broadcasterId ? { broadcaster_id: twitch.broadcasterId } : {}),
                ...(twitch.moderatorId ? { moderator_id: twitch.moderatorId } : {}),
                ...(twitch.daToken ? { donationalerts_token: twitch.daToken } : {}),
                ...(twitch.dpKey ? { donatepay_key: twitch.dpKey } : {}),
                donationalerts_enabled: twitch.daEnabled,
                donatepay_enabled: twitch.dpEnabled,
                twitch_bits_enabled: twitch.bitsEnabled,
              }).then((r) => {
                if (r.ok) setTwitch({ ...twitch, token: '', clientId: '', broadcasterId: '', moderatorId: '', daToken: '', dpKey: '' })
                return r
              })
            )
          }
        />
      </div>
    </section>
  )
})
