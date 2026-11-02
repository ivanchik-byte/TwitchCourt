import { memo } from 'react'
import { HelpTip } from '../../components/HelpTip'
import { apiPut } from '../../lib/api'
import { SecretField } from '../../components/SecretField'
import { inputCls, labelCls, saveSection, SaveButton, type TwitchState } from './shared'

interface Props {
  twitch: TwitchState
  setTwitch: (v: TwitchState) => void
  has: Record<string, boolean>
  onSaved: (has: Record<string, boolean>) => void
}

export const IntegrationsSection = memo(function IntegrationsSection({ twitch, setTwitch, has, onSaved }: Props) {
  return (
    <section className="card space-y-2 p-4">
      <p className="settings-note">Для чата нужны канал, ник и OAuth-токен аккаунта бота. Донат-сервисы подключаются отдельно. Пустые поля токенов сохраняют прежние значения; отметка «задан» не подтверждает соединение.</p>
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
      <SecretField label="Twitch OAuth" saved={has.twitch_token} help={<HelpTip label="Twitch OAuth">Токен того аккаунта, чей ник указан у бота. Для чтения и отправки сообщений нужны права chat:read и chat:edit. Для наказаний бот должен быть модератором канала; Для банов, таймаутов и разбана нужны Client ID, ID стримера и право токена moderator:manage:banned_users. ID модератора должен принадлежать владельцу токена.</HelpTip>} value={twitch.token} onChange={(v) => setTwitch({ ...twitch, token: v })} />
      <div className="integration-ids">
        <label className={labelCls}>Twitch Client ID <HelpTip label="Twitch Client ID">Идентификатор приложения из Twitch Developer Console для запросов Helix. Это не секретный OAuth-токен.</HelpTip><input value={twitch.clientId} onChange={event => setTwitch({ ...twitch, clientId: event.target.value })} className={inputCls} /></label>
        <label className={labelCls}>ID стримера<input value={twitch.broadcasterId} onChange={event => setTwitch({ ...twitch, broadcasterId: event.target.value })} className={inputCls} placeholder="Для разбанов" /></label>
        <label className={labelCls}>ID модератора<input value={twitch.moderatorId} onChange={event => setTwitch({ ...twitch, moderatorId: event.target.value })} className={inputCls} placeholder="По умолчанию ID стримера" /></label>
      </div>
      <SecretField label="DonationAlerts токен" saved={has.donationalerts_token} help={<HelpTip label="DonationAlerts">Токен виджета оповещений DonationAlerts: значение после ?token= в ссылке виджета. Вставляйте сам токен, а не всю ссылку. Это не OAuth-ключ языковой модели.</HelpTip>} value={twitch.daToken} onChange={(v) => setTwitch({ ...twitch, daToken: v })} />
      <SecretField label="DonatePay ключ" saved={has.donatepay_key} help={<HelpTip label="DonatePay">API-ключ аккаунта DonatePay. После подключения проверьте доставку пробного события; правила взяток и очереди находятся в разделе «Донаты».</HelpTip>} value={twitch.dpKey} onChange={(v) => setTwitch({ ...twitch, dpKey: v })} />
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
                client_id: twitch.clientId,
                broadcaster_id: twitch.broadcasterId,
                moderator_id: twitch.moderatorId,
                ...(twitch.daToken ? { donationalerts_token: twitch.daToken } : {}),
                ...(twitch.dpKey ? { donatepay_key: twitch.dpKey } : {}),
                donationalerts_enabled: twitch.daEnabled,
                donatepay_enabled: twitch.dpEnabled,
                twitch_bits_enabled: twitch.bitsEnabled,
              }).then((r) => {
                if (r.ok) {
                  onSaved({ ...has, twitch_token: !!twitch.token || has.twitch_token, donationalerts_token: !!twitch.daToken || has.donationalerts_token, donatepay_key: !!twitch.dpKey || has.donatepay_key })
                  setTwitch({ ...twitch, token: '', daToken: '', dpKey: '' })
                }
                return r
              })
            )
          }
        />
      </div>
    </section>
  )
})
