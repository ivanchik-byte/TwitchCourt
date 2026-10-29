import { useEffect, useState } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'

export function SecretField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onCommit?: (v: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(id)
  }, [copied])

  return (
    <label className="secret-field">
      <span >{label}</span>
      <div className="secret-input-row">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder ?? '••••••••'}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit?.((e.target as HTMLInputElement).value)
          }}

        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}

          aria-label={visible ? 'Скрыть' : 'Показать'}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value)
            setCopied(true)
          }}

          aria-label="Копировать"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </label>
  )
}
