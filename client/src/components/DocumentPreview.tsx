import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'

interface DocumentPreviewProps {
  url: string
  mime?: string
  name?: string
}

type PreviewKind = 'pdf' | 'markdown' | 'text' | 'json' | 'csv' | 'docx' | 'xlsx' | 'rtf' | 'unknown'

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const sanitizeHtml = (unsafeHtml: string) =>
  DOMPurify.sanitize(unsafeHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  })

const getExtension = (name?: string) => {
  if (!name) return ''
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

const resolvePreviewKind = (mime?: string, name?: string): PreviewKind => {
  const ext = getExtension(name)
  const lowerMime = mime?.toLowerCase() || ''

  if (lowerMime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (lowerMime === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown'
  if (lowerMime === 'application/json' || ext === 'json') return 'json'
  if (lowerMime === 'text/csv' || ext === 'csv') return 'csv'
  if (lowerMime === 'application/rtf' || lowerMime === 'text/rtf' || ext === 'rtf') return 'rtf'
  if (lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'docx'
  if (
    lowerMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lowerMime === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) return 'xlsx'
  if (lowerMime.startsWith('text/') || ext === 'txt') return 'text'

  return 'unknown'
}

export default function DocumentPreview({ url, mime, name }: DocumentPreviewProps) {
  const kind = useMemo(() => resolvePreviewKind(mime, name), [mime, name])
  const [html, setHtml] = useState<string>('')
  const [text, setText] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setError(null)
    setHtml('')
    setText('')

    if (kind === 'pdf') return

    const load = async () => {
      setLoading(true)
      try {
        if (kind === 'docx') {
          const response = await fetch(url)
          const buffer = await response.arrayBuffer()
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          setHtml(sanitizeHtml(result.value))
          return
        }

        if (kind === 'xlsx') {
          const response = await fetch(url)
          const buffer = await response.arrayBuffer()
          const workbook = XLSX.read(buffer, { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          const sheet = workbook.Sheets[sheetName]
          if (sheet) {
            const tableHtml = XLSX.utils.sheet_to_html(sheet)
            setHtml(sanitizeHtml(tableHtml))
          }
          return
        }

        if (kind === 'rtf') {
          const response = await fetch(url)
          const raw = await response.text()
          const plain = raw
            .replace(/\\par[d]?/g, '\n')
            .replace(/\\'[0-9a-fA-F]{2}/g, (match) => {
              const code = parseInt(match.slice(2), 16)
              return Number.isNaN(code) ? '' : String.fromCharCode(code)
            })
            .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
            .replace(/[{}]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
          setText(plain)
          return
        }

        const response = await fetch(url)
        const rawText = await response.text()

        if (kind === 'markdown') {
          setHtml(sanitizeHtml(await marked.parse(rawText)))
          return
        }

        if (kind === 'json') {
          try {
            const formatted = JSON.stringify(JSON.parse(rawText), null, 2)
            setText(formatted)
          } catch {
            setText(rawText)
          }
          return
        }

        if (kind === 'csv') {
          const parsed = Papa.parse<string[]>(rawText, { skipEmptyLines: true })
          if (parsed.data.length > 0) {
            const [header, ...rows] = parsed.data
            const htmlRows = rows
              .map((row: string[]) => `<tr>${row.map((cell: string) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
              .join('')
            const htmlHeader = header
              ? `<tr>${header.map((cell: string) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>`
              : ''
            setHtml(sanitizeHtml(`<table><thead>${htmlHeader}</thead><tbody>${htmlRows}</tbody></table>`))
          } else {
            setText(rawText)
          }
          return
        }

        setText(rawText)
      } catch {
        setError('Preview failed to load')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [kind, url])

  if (kind === 'pdf') {
    return (
      <iframe
        src={url}
        title={name || 'Document preview'}
        className="h-[80vh] w-full rounded-lg bg-white"
      />
    )
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-200">Loading preview...</div>
  }

  if (error || kind === 'unknown') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-white">
        <div className="text-lg font-semibold">Preview not available</div>
        <div className="text-sm text-white/70">Download to view this file.</div>
      </div>
    )
  }

  if (html) {
    return (
      <div
        className="max-h-[80vh] overflow-auto rounded-lg bg-white p-4 text-gray-900 prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="max-h-[80vh] overflow-auto rounded-lg bg-gray-900/80 p-4 text-xs text-gray-100">
      {text}
    </pre>
  )
}
