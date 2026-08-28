import type { InputHTMLAttributes } from 'react'

/**
 * Trims a typed or pasted value down to something that can be a price:
 * digits, at most one decimal point, at most two places after it.
 *
 * Truncating rather than rejecting matters for pasting -- dropping the whole
 * value because it had three decimals would be worse than keeping the two
 * that fit. While typing, the effect is that a third decimal simply does
 * nothing, since the clamped result equals what is already in the field.
 */
export function clampMoney(raw: string): string {
  let value = raw.replace(/[^\d.]/g, '')

  const dot = value.indexOf('.')
  if (dot === -1) return value

  // keep the first decimal point, drop any others ("4.5.6" -> "4.56")
  const whole = value.slice(0, dot)
  const fraction = value.slice(dot + 1).replace(/\./g, '')
  value = `${whole}.${fraction.slice(0, 2)}`

  return value
}

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: string
  onChange: (value: string) => void
}

/**
 * The money field used everywhere a price or budget is entered.
 *
 * It is type="text" with inputMode="decimal" rather than type="number", for
 * two reasons: a number input reports an empty string for anything it cannot
 * parse (typing "45." reads as ""), which makes trimming the fraction as you
 * type impossible; and it drops the spinner arrows, which the design does not
 * show on a price field anyway. The keyboard on mobile is still numeric.
 */
export default function MoneyInput({ value, onChange, onBlur, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(clampMoney(event.target.value))}
      onBlur={(event) => {
        // tidy the half-typed forms on the way out: ".5" -> "0.5", "5." -> "5".
        // applied in sequence, so a lone "." resolves all the way to "0".
        let tidied = value.startsWith('.') ? `0${value}` : value
        if (tidied.endsWith('.')) tidied = tidied.slice(0, -1)
        if (tidied !== value) onChange(tidied)
        onBlur?.(event)
      }}
    />
  )
}
