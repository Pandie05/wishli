/**
 * The 1–5 wish rating. Matches the items_priority_range constraint added in
 * 011; null means unrated, and clicking the current value clears it.
 */
export const PRIORITY_LABELS: Record<number, string> = {
  1: 'just an idea',
  2: 'nice to have',
  3: 'really like this',
  4: 'would really love this',
  5: 'top of my list',
}

type Props = {
  value: number | null
  onChange: (value: number | null) => void
}

export default function PriorityPicker({ value, onChange }: Props) {
  return (
    <div className="rating">
      {[1, 2, 3, 4, 5].map((step) => (
        <button
          key={step}
          type="button"
          className="rating-step"
          aria-pressed={value === step}
          aria-label={`${step} — ${PRIORITY_LABELS[step]}`}
          onClick={() => onChange(value === step ? null : step)}
        >
          {step}
        </button>
      ))}

      <span className="rating-caption">
        {value ? `${value} — ${PRIORITY_LABELS[value]}` : 'no rating'}
      </span>
    </div>
  )
}
