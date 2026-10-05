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
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      <div className="flex gap-1.5">
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
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="pressable rounded-lg border border-white/10 px-2 text-zinc-400 hover:text-white"
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
          className="pressable rounded-lg border border-white/10 px-2 text-zinc-400 hover:text-white"
          aria-label="Копировать"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </label>
  )
}
