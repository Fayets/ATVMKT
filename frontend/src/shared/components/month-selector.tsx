'use client'

type MonthSelectorProps = {
  month: string
  options: { value: string; label: string }[]
  onChange: (month: string) => void
}

export function MonthSelector({ month, options, onChange }: MonthSelectorProps) {
  return (
    <select
      value={month}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none capitalize transition-colors focus:border-[var(--text3)] cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
