import { memo } from 'react'
import { apiPut, apiPost } from '../../lib/api'
import { inputCls, labelCls, saveSection, SaveButton, type TtsState, type VoiceLists } from './shared'

interface Props {
  tts: TtsState
  setTts: (v: TtsState) => void
  voices: VoiceLists
}

export const TtsSection = memo(function TtsSection({ tts, setTts, voices }: Props) {
  const effectiveVoice = tts.voice === 'custom' ? tts.customVoice : tts.voice
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Синтез речи</h2>
      {tts.beep && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] p-2.5 text-xs text-amber-200">
          Включен резервный сигнал: движок синтеза недоступен либо не найден файл модели. Проверьте настройки ниже.
        </div>
      )}
      <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] p-2.5 text-xs text-zinc-300">
        <span className="font-semibold text-emerald-200">Локальный голос:</span> Silero ({tts.sileroJudge || 'kseniya'}).
        Работает автономно без внешних сетевых запросов.
      </div>
      <label className={labelCls}>
        Движок
        <select
          value={tts.engine}
          onChange={(e) => setTts({ ...tts, engine: e.target.value })}
          className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
        >
          <option value="edge">Edge</option>
          <option value="silero">Silero</option>
          <option value="piper">Piper</option>
          <option value="mock">Mock</option>
        </select>
      </label>
      <label className={labelCls}>
        Голос
        <select
          value={tts.voice}
          onChange={(e) => setTts({ ...tts, voice: e.target.value })}
          className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
        >
          {voices.edge.map((v) => (
            <option key={v} value={v}>{v}{v.includes('Svetlana') ? ' ♀' : ''}</option>
          ))}
          <option value="custom">Свой…</option>
        </select>
      </label>
      {tts.voice === 'custom' && (
        <label className={labelCls}>
          Свой голос
          <input
            value={tts.customVoice}
            onChange={(e) => setTts({ ...tts, customVoice: e.target.value })}
            placeholder="ru-RU-…"
            className={inputCls}
          />
        </label>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <label className={labelCls}>
          Темп
          <input value={tts.rate} onChange={(e) => setTts({ ...tts, rate: e.target.value })} placeholder="-10%" className={inputCls} />
        </label>
        <label className={labelCls}>
          Громкость
          <input value={tts.volume} onChange={(e) => setTts({ ...tts, volume: e.target.value })} placeholder="+0%" className={inputCls} />
        </label>
        <label className={labelCls}>
          Тон
          <input value={tts.pitch} onChange={(e) => setTts({ ...tts, pitch: e.target.value })} placeholder="+0Hz" className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className={labelCls}>
          Голос судьи
          <input value={tts.judgeVoice} onChange={(e) => setTts({ ...tts, judgeVoice: e.target.value })} className={inputCls} />
        </label>
        <label className={labelCls}>
          Темп судьи
          <input value={tts.judgeRate} onChange={(e) => setTts({ ...tts, judgeRate: e.target.value })} className={inputCls} />
        </label>
      </div>
      <label className={labelCls}>
        Голос Silero
        <select
          value={tts.sileroJudge}
          onChange={(e) => setTts({ ...tts, sileroJudge: e.target.value })}
          className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
        >
          {voices.silero.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
          {!voices.silero.includes(tts.sileroJudge) && (
            <option value={tts.sileroJudge}>{tts.sileroJudge} (с сервера)</option>
          )}
        </select>
      </label>
      {tts.engine === 'silero' && (
        <label className={labelCls}>
          Silero URL
          <input value={tts.sileroUrl} onChange={(e) => setTts({ ...tts, sileroUrl: e.target.value })} className={inputCls} />
        </label>
      )}
      {tts.engine === 'piper' && (
        <details className="rounded-lg border border-white/10 p-2.5">
          <summary className="cursor-pointer text-xs text-zinc-300">Параметры Piper (при смене путей требуется перезапуск)</summary>
          <div className="mt-2 space-y-2">
            <label className={labelCls}>
              Путь к бинарнику
              <input value={tts.piperBinary} onChange={(e) => setTts({ ...tts, piperBinary: e.target.value })} placeholder="bin/piper" className={inputCls} />
            </label>
            <label className={labelCls}>
              Модель (.onnx)
              <input value={tts.modelPath} onChange={(e) => setTts({ ...tts, modelPath: e.target.value })} className={inputCls} />
            </label>
            <label className={labelCls}>
              Конфиг модели (.json)
              <input value={tts.configPath} onChange={(e) => setTts({ ...tts, configPath: e.target.value })} className={inputCls} />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <label className={labelCls}>
                Speaker ID
                <input value={tts.speakerId} onChange={(e) => setTts({ ...tts, speakerId: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className={inputCls} />
              </label>
              <label className={labelCls}>
                Скорость
                <input value={tts.speed} onChange={(e) => setTts({ ...tts, speed: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={inputCls} />
              </label>
            </div>
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={tts.enabled} onChange={(e) => setTts({ ...tts, enabled: e.target.checked })} />
          Озвучка включена
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={tts.autoFallback} onChange={(e) => setTts({ ...tts, autoFallback: e.target.checked })} />
          Резервный движок при сбое
        </label>
      </div>
      <div className="flex gap-1.5">
        <SaveButton
          onSave={() =>
            saveSection('TTS', () =>
              apiPut('/api/tts', {
                engine: tts.engine,
                voice: effectiveVoice,
                rate: tts.rate,
                volume: tts.volume,
                pitch: tts.pitch,
                judge_voice: tts.judgeVoice,
                judge_rate: tts.judgeRate,
                silero_url: tts.sileroUrl,
                silero_judge: tts.sileroJudge,
                enabled: tts.enabled,
                auto_fallback: tts.autoFallback,
                ...(tts.piperBinary ? { piper_binary: tts.piperBinary } : {}),
                ...(tts.modelPath ? { model_path: tts.modelPath } : {}),
                ...(tts.configPath ? { config_path: tts.configPath } : {}),
                speaker_id: Number(tts.speakerId) || 0,
                speed: Number(tts.speed) || 1.15,
              })
            )
          }
        />
        <button
          onClick={() => void apiPost('/api/say', { text: 'Проверка голоса судьи. Суд идёт.' })}
          className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
        >
          Прослушать голос
        </button>
      </div>
    </section>
  )
})
