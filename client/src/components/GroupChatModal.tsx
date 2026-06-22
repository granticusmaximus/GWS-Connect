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

interface GroupChatModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated?: () => void
}

export default function GroupChatModal({ isOpen, onClose, onCreated }: GroupChatModalProps) {
  const [groupName, setGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const { createGroupChat, setActiveGroupChat } = useChatStore()

  useEffect(() => {
    if (!isOpen) {
      setGroupName('')
      setSearchQuery('')
      setSearchResults([])
      setSelectedUsers([])
      setError('')
    }
  }, [isOpen])

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
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounce)
  }, [searchQuery])

  const toggleUser = (user: User) => {
    setSelectedUsers((current) =>
      current.some((selected) => selected.id === user.id)
        ? current.filter((selected) => selected.id !== user.id)
        : [...current, user],
    )
  }

  const handleCreate = async () => {
    if (!groupName.trim() || selectedUsers.length === 0) {
      setError('Enter a name and select at least one member')
      return
    }

    setCreating(true)
    setError('')
    const groupChat = await createGroupChat(groupName.trim(), selectedUsers.map((user) => user.id))
    setCreating(false)

    if (!groupChat) {
      setError('Failed to create group chat')
      return
    }

    setActiveGroupChat(groupChat.id)
    onCreated?.()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            New Group Chat
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            autoFocus
          />

          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200"
                >
                  {user.username}
                  <button type="button" onClick={() => toggleUser(user)} aria-label={`Remove ${user.username}`}>
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users to add..."
              className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="max-h-64 overflow-y-auto p-4 pt-0">
          {loading && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400">Searching...</div>
          )}

          {!loading && searchQuery && searchResults.length === 0 && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400">No users found</div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="space-y-1">
              {searchResults.map((user) => {
                const isSelected = selectedUsers.some((selected) => selected.id === user.id)
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user)}
                    className={`w-full flex items-center space-x-3 p-2 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-primary-50 dark:bg-primary-900/20'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden">
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                          {user.username.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-sm text-gray-900 dark:text-white">{user.username}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
