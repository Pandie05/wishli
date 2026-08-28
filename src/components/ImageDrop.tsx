import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Kept in step with the bucket's file_size_limit in 011. */
const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const BUCKET = 'wishli-images'

type Props = {
  value: string | null
  onChange: (url: string | null) => void
  /** uploads are keyed under the uploader's id -- see the storage policies */
  userId: string | null
  onError: (message: string | null) => void
  hint?: string
}

function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The dashed "drop or upload an image" control. Uploads go to the public
 * wishli-images bucket under "<user id>/<random>.<ext>", which is the shape
 * the storage policies in 011 require -- the first path segment has to be the
 * uploader's id or the insert is rejected.
 */
export default function ImageDrop({ value, onChange, userId, onError, hint }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    if (busy) return

    if (!userId) {
      onError('still signing you in -- try again in a moment')
      return
    }
    if (!ACCEPT.includes(file.type)) {
      onError('that file is not a PNG, JPG, WEBP or GIF')
      return
    }
    if (file.size > MAX_BYTES) {
      onError('that image is over 5 MB')
      return
    }

    setBusy(true)
    onError(null)

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    })

    setBusy(false)

    if (error) {
      // the most likely cause by far is 011 not having been run yet
      onError(`upload failed: ${error.message}`)
      return
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    onChange(data.publicUrl)
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) upload(file)
  }

  return (
    <div
      className="drop"
      data-over={over ? 'true' : undefined}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      <span className="drop-thumb">
        {value ? <img src={value} alt="" /> : <PlaceholderIcon />}
      </span>

      <span className="drop-text">
        <span className="drop-title">
          {busy ? 'Uploading...' : value ? 'Image added' : 'Drop or upload an image'}
        </span>
        <span className="drop-sub">{hint ?? "PNG or JPG up to 5 MB — or we'll pull it from the link"}</span>
      </span>

      {value && !busy && (
        <button
          type="button"
          className="drop-clear"
          onClick={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
        >
          Remove
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        hidden
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
