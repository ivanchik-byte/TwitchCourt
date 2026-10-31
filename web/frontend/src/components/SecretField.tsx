import { useEffect, useId, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'

export function SecretField({ label, value, onChange, onCommit, placeholder, help, saved = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  onCommit?: (value: string) => void
  help?: ReactNode
  placeholder?: string
  saved?: boolean
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  return <div className="secret-field">
    <div className="secret-label"><label htmlFor={id}>{label}</label>{help}<span className="secret-state">{value ? 'Новое значение' : saved ? 'Сохранён' : 'Не задан'}</span></div>
    <div className="secret-input-row">
      <input id={id} type={visible ? 'text' : 'password'} value={value}
        placeholder={placeholder ?? (saved ? 'Оставить сохранённый ключ' : 'Введите ключ')}
        autoComplete="off" spellCheck={false}
        onChange={event => { setCopyError(false); onChange(event.target.value) }}
        onBlur={event => onCommit?.(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') onCommit?.(event.currentTarget.value) }} />
      {value && <><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Скрыть ключ' : 'Показать ключ'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        <button type="button" aria-label="Копировать введённый ключ" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setCopyError(false) }
          catch { setCopyError(true) }
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></>}
    </div>
    {copyError && <p role="status" className="field-note">Браузер не разрешил копирование. Выделите значение вручную.</p>}
  </div>
}
