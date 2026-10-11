import { memo, useState } from 'react'
import { toast } from 'sonner'
import { apiPut, apiPostJson, apiNote } from '../../lib/api'
import { SecretField } from '../../components/SecretField'
import { parseAISnippet } from '../../lib/parseSnippet'
import { inputCls, labelCls, roundTemp, saveSection, SaveButton, type AiState } from './shared'

interface Props {
  ai: AiState
  setAi: (v: AiState) => void
  apiKey: string
  setApiKey: (v: string) => void
  flags: { has_key: boolean; live: boolean; has_extra_body?: boolean } | null
}

const KNOWN = ['groq', 'cerebras', 'ollama', 'custom']

export const AiSection = memo(function AiSection({ ai, setAi, apiKey, setApiKey, flags }: Props) {
  const [importOpen, setImportOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [extraDirty, setExtraDirty] = useState(false)
  const parsed = parseAISnippet(paste)

  const applySnippet = () => {
    setAi({
      ...ai,
      provider: 'custom',
      baseUrl: parsed.baseUrl ?? ai.baseUrl,
      model: parsed.model ?? ai.model,
      temperature: parsed.temperature ?? ai.temperature,
      extraBody: parsed.extraBody ? JSON.stringify(parsed.extraBody, null, 2) : ai.extraBody,
    })
    if (parsed.apiKey) setApiKey(parsed.apiKey)
    if (parsed.extraBody) setExtraDirty(true)
    setPaste('')
    setImportOpen(false)
    toast.success('Сниппет разобран, проверь и сохрани')
  }

  const savePayload = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      provider: ai.provider,
      model: ai.model,
      temperature: roundTemp(ai.temperature),
      base_url: ai.baseUrl,
      ...(apiKey ? { api_key: apiKey } : {}),
    }
    if (extraDirty) {
      const text = ai.extraBody.trim()
      if (!text) {
        body.extra_body = {}
      } else {
        try {
          body.extra_body = JSON.parse(text)
        } catch {
          toast.error('Параметры роутера — невалидный JSON')
          throw new Error('bad extra_body')
        }
      }
    }
    return body
  }

  const clearExtra = async () => {
    if (!window.confirm('Убрать параметры роутера?')) return
    const r = await apiPut('/api/ai', { extra_body: {} })
    if (r.ok) {
      setAi({ ...ai, extraBody: '' })
      setExtraDirty(false)
      toast.success('Параметры роутера убраны')
    } else toast.error(apiNote(r.status))
  }

  return (
    <section className="card space-y-2 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Языковая модель</h2>
        {flags && (
          <span className={`font-mono text-xs ${flags.live ? 'text-emerald-300' : 'text-zinc-500'}`}>
            {flags.live ? '● live' : '○ off'}
          </span>
        )}
        <button
          onClick={() => setImportOpen(true)}
          className="pressable ml-auto rounded-lg border border-white/10 px-2.5 py-1 text-xs"
        >
          Быстрый импорт
        </button>
      </div>
      <label className={labelCls}>
        Провайдер
        <select
          value={KNOWN.includes(ai.provider) ? ai.provider : 'custom'}
          onChange={(e) => setAi({ ...ai, provider: e.target.value })}
          className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
        >
          <option value="groq">Groq</option>
          <option value="cerebras">Cerebras</option>
          <option value="ollama">Ollama (локально)</option>
          <option value="custom">Свой (OpenAI-совместимый)</option>
        </select>
      </label>
      <label className={labelCls}>
        Base URL {ai.provider === 'ollama' ? '(пусто = localhost:11434)' : '(пусто = preset провайдера)'}
        <input
          value={ai.baseUrl}
          onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
          placeholder="https://llm.onerouter.pro/v1"
          className={inputCls}
        />
      </label>
      <SecretField label="API-ключ" value={apiKey} onChange={setApiKey} />
      <label className={labelCls}>
        Модель
        <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} className={inputCls} />
      </label>
      <label className={labelCls}>
        Параметры роутера (JSON) {flags?.has_extra_body && !extraDirty ? '· заданы, скрыты' : ''}
        <textarea
          value={ai.extraBody}
          onChange={(e) => {
            setAi({ ...ai, extraBody: e.target.value })
            setExtraDirty(true)
          }}
          placeholder='{"provider": {"service_tier": "standard"}}'
          rows={3}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs text-white outline-none"
        />
      </label>
      {(flags?.has_extra_body || extraDirty) && (
        <button onClick={() => void clearExtra()} className="text-xs text-zinc-500 underline">
          Убрать параметры роутера
        </button>
      )}
      <label className={labelCls}>
        Температура: {roundTemp(ai.temperature).toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ai.temperature}
          onChange={(e) => setAi({ ...ai, temperature: roundTemp(Number(e.target.value)) })}
          className="mt-1 w-full"
        />
      </label>
      <div className="flex gap-1.5">
        <SaveButton
          onSave={() => {
            let body: Record<string, unknown>
            try {
              body = savePayload()
            } catch {
              return
            }
            saveSection('Языковая модель', () =>
              apiPut('/api/ai', body).then((r) => {
                if (r.ok) {
                  setApiKey('')
                  setExtraDirty(false)
                }
                return r
              })
            )
          }}
        />
        <button
          onClick={async () => {
            const r = await apiPostJson<{ ms: number }>('/api/ai/ping', {})
            if (!r.ok || !r.data) {
              toast.error(`Проверка модели: ${apiNote(r.status)} (нужен ключ или URL)`)
              return
            }
            toast.success(`Ответ получен за ${r.data.ms} мс`)
          }}
          className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
        >
          Тест подключения
        </button>
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-3" onClick={() => setImportOpen(false)}>
          <div
            className="card w-full max-w-[560px] space-y-2 p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Быстрый импорт"
          >
            <h3 className="font-semibold">Вставь пример провайдера</h3>
            <p className="text-xs text-zinc-500">Python SDK, cURL или JSON — разберу URL, ключ, модель и параметры.</p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={8}
              placeholder={'client = OpenAI(\n  base_url="https://llm.onerouter.pro/v1",\n  api_key="sk-...",\n)'}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs text-white outline-none"
            />
            {(parsed.baseUrl || parsed.model || parsed.extraBody) && (
              <dl className="space-y-1 font-mono text-xs text-zinc-300">
                {parsed.baseUrl && <div><dt className="inline text-zinc-500">URL: </dt><dd className="inline">{parsed.baseUrl}</dd></div>}
                {parsed.model && <div><dt className="inline text-zinc-500">Модель: </dt><dd className="inline">{parsed.model}</dd></div>}
                {parsed.apiKey && <div><dt className="inline text-zinc-500">Ключ: </dt><dd className="inline">•••{parsed.apiKey.slice(-4)}</dd></div>}
                {parsed.extraBody && <div><dt className="inline text-zinc-500">Параметры: </dt><dd className="inline">{JSON.stringify(parsed.extraBody)}</dd></div>}
              </dl>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={applySnippet}
                disabled={!parsed.baseUrl && !parsed.model && !parsed.extraBody}
                className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black disabled:opacity-40"
              >
                Применить
              </button>
              <button
                onClick={() => {
                  setPaste('')
                  setImportOpen(false)
                }}
                className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
})
