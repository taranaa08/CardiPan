import { useState, type FormEvent } from 'react'
import { fmt } from '../api'

// Each preset shows where the number comes from so it doesn't look invented.
// TODO(pitch owner): find a citable source for 2,000 mg or drop the preset.
const PRESETS = [
  { mg: 1500, source: 'American Heart Association: ideal limit for most adults, especially with high blood pressure' },
  { mg: 2000, source: 'Often given for heart failure. Confirm with your care team.' },
  { mg: 2300, source: 'Dietary Guidelines for Americans and AHA: upper limit for adults' },
]

type Props = {
  current: number | null
  onSave: (mg: number) => Promise<void>
  onCancel?: () => void
}

export function TargetScreen({ current, onSave, onCancel }: Props) {
  const [value, setValue] = useState(current ? String(current) : '')
  const [saving, setSaving] = useState(false)
  const mg = Number(value)
  const valid = Number.isInteger(mg) && mg > 0 && mg <= 10000

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      await onSave(mg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="screen target" onSubmit={submit}>
      {current ? (
        <p className="eyebrow">Your target</p>
      ) : (
        <p className="eyebrow eyebrow--step">
          <span className="step-num">1</span> Your target
        </p>
      )}
      <h1>What's your daily sodium limit?</h1>
      <p className="lede">Use the number on your discharge sheet or the one your care team gave you.</p>

      <div className="presets" role="radiogroup" aria-label="Common limits">
        {PRESETS.map((p) => (
          <button
            key={p.mg}
            type="button"
            role="radio"
            aria-checked={mg === p.mg}
            className="preset"
            onClick={() => setValue(String(p.mg))}
          >
            <span className="preset-mg">{fmt(p.mg)} mg</span>
            <span className="preset-source">{p.source}</span>
          </button>
        ))}
      </div>

      <label className="custom-target">
        <span>Or enter your number</span>
        <span className="input-with-unit">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step={1}
            placeholder="e.g. 1800"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span>mg / day</span>
        </span>
      </label>

      <p className="note">This app doesn't set your target. Your clinician does.</p>

      <div className="actions">
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={!valid || saving}>
          {current ? 'Save target' : 'Continue'}
        </button>
      </div>
    </form>
  )
}
