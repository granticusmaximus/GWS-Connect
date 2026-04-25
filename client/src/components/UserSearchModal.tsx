import { useState, useEffect } from 'react'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import axios from 'axios'
import { API_URL } from '../config/runtime'
import { useChatStore } from '../store/chatStore'

interface User {
  id: string
  username: string
  email: string
  avatar?: string
}

interface UserSearchModalProps {
  isOpen: boolean
  onClose: () => void
  onUserSelected?: () => void
}

export default function UserSearchModal({ isOpen, onClose, onUserSelected }: UserSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const { setActiveDM, upsertDirectConversation } = useChatStore()

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const delayDebounce = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await axios.get(`${API_URL}/users/search?q=${searchQuery}`)
        setSearchResults(response.data)
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounce)
  }, [searchQuery])

  const handleSelectUser = (user: User) => {
    upsertDirectConversation({
      id: user.id,
      userId: user.id,
      username: user.username,
      avatar: user.avatar || null,
      unreadCount: 0,
    })
    setActiveDM(user.id)
    onUserSelected?.()
    onClose()
    setSearchQuery('')
    setSearchResults([])
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Start a Conversation
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users by name or email..."
              className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              autoFocus
            />
          </div>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto p-4 pt-0">
          {loading && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400">
              Searching...
            </div>
          )}
          
          {!loading && searchQuery && searchResults.length === 0 && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400">
              No users found
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className="w-full flex items-center space-x-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden">
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                        {user.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {user.username}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {user.email}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searchQuery && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <MagnifyingGlassIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Search for users to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
