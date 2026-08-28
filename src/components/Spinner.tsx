import '../css/spinner.css'

type Props = {
  /** announced to screen readers; the ring itself is decorative */
  label?: string
  className?: string
}

/**
 * A real in-flight indicator: it is mounted only while a request is actually
 * running and unmounted when it settles, so it never implies progress that is
 * not happening. It takes its colour from the surrounding text and its size
 * from font-size, so it sits inside a button or a field without extra rules.
 */
export default function Spinner({ label = 'Loading', className }: Props) {
  return (
    <span className={className ? `spinner-wrap ${className}` : 'spinner-wrap'} role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="spinner-sr">{label}</span>
    </span>
  )
}
