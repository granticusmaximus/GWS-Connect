import { useEffect, useState } from 'react'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import axios from 'axios'
import { API_URL } from '../config/runtime'

interface GifItem {
  id: string
  title: string
  url: string
  previewUrl: string
}

interface GifPickerModalProps {
  isOpen: boolean
  initialQuery?: string
  onClose: () => void
  onSelect: (gif: GifItem) => void
}

export default function GifPickerModal({ isOpen, initialQuery = '', onClose, onSelect }: GifPickerModalProps) {
  const [query, setQuery] = useState(initialQuery)
  const [gifs, setGifs] = useState<GifItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setQuery(initialQuery)
  }, [isOpen, initialQuery])

  useEffect(() => {
    if (!isOpen) return

    const fetchTrending = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await axios.get(`${API_URL}/gifs/trending`)
        setGifs(response.data?.results || [])
      } catch (err) {
        setError('Unable to load GIFs')
      } finally {
        setLoading(false)
      }
    }

    void fetchTrending()
  }, [isOpen])

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get(`${API_URL}/gifs/search`, {
        params: { q: query.trim() },
      })
      setGifs(response.data?.results || [])
    } catch (err) {
      setError('Unable to load GIFs')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Select a GIF</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSearch()
                  }
                }}
                placeholder="Search Giphy GIFs"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm"
            >
              Search
            </button>
          </div>

          {error && <div className="mt-3 text-sm text-red-500">{error}</div>}

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto">
            {loading ? (
              <div className="col-span-full text-sm text-gray-500">Loading GIFs...</div>
            ) : (
              gifs.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => onSelect(gif)}
                  className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:shadow-md transition"
                >
                  <img src={gif.previewUrl} alt={gif.title} className="w-full h-32 object-cover" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
