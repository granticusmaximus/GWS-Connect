import { useEffect, useState } from 'react'
import axios from 'axios'
import { API_URL } from '../config/runtime'

interface LinkPreviewData {
  url: string
  resolvedUrl?: string | null
  title?: string | null
  description?: string | null
  imageUrl?: string | null
  siteName?: string | null
  faviconUrl?: string | null
}

interface LinkPreviewProps {
  url: string
}

export default function LinkPreview({ url }: LinkPreviewProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null)

  useEffect(() => {
    let cancelled = false

    void axios
      .get(`${API_URL}/link-previews`, { params: { url } })
      .then((response) => {
        if (!cancelled) {
          setPreview(response.data)
        }
      })
      .catch((error) => {
        console.error('Error loading link preview:', error)
        if (!cancelled) {
          setPreview(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [url])

  if (!preview?.title && !preview?.description) {
    return null
  }

  const href = preview.resolvedUrl || preview.url || url
  const hostname = (() => {
    try {
      return new URL(href).hostname
    } catch {
      return href
    }
  })()

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-3 block overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-primary-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-primary-600"
    >
      {preview.imageUrl && (
        <img
          src={preview.imageUrl}
          alt={preview.title || preview.siteName || 'Link preview'}
          className="h-40 w-full object-cover"
        />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
          {preview.faviconUrl && (
            <img src={preview.faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
          )}
          <span>{preview.siteName || hostname}</span>
        </div>
        <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">
          {preview.title}
        </div>
        {preview.description && (
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
            {preview.description}
          </div>
        )}
      </div>
    </a>
  )
}
