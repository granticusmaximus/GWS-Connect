import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../store/chatStore'
import Header from '../components/Header'
import axios from 'axios'
import { API_URL } from '../config/runtime'
import { 
  UserPlusIcon, 
  CheckIcon, 
  XMarkIcon, 
  ChatBubbleLeftIcon,
  MagnifyingGlassIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'

interface Friend {
  id: number
  username: string
  avatar?: string
  bio?: string
}

interface FriendRequest {
  id: number
  username: string
  avatar?: string
  bio?: string
  createdAt: string
}

export default function Friends() {
  const navigate = useNavigate()
  const { setActiveDM, upsertDirectConversation } = useChatStore()
  const [friends, setFriends] = useState<Friend[]>([])
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Friend[]>([])
  const [friendshipStatuses, setFriendshipStatuses] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)

  const loadFriends = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/friends`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriends(response.data)
    } catch (error) {
      console.error('Error loading friends:', error)
    }
  }

  const loadPendingRequests = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/friends/requests/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setPendingRequests(response.data)
    } catch (error) {
      console.error('Error loading pending requests:', error)
    }
  }

  const searchUsers = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/friends/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSearchResults(response.data)
      
      // Load friendship status for each result
      const statuses: Record<number, string> = {}
      for (const user of response.data) {
        try {
          const statusResponse = await axios.get(`${API_URL}/friends/status/${user.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          statuses[user.id] = statusResponse.data.status || 'none'
        } catch {
          statuses[user.id] = 'none'
        }
      }
      setFriendshipStatuses(statuses)
    } catch (error) {
      console.error('Error searching users:', error)
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  useEffect(() => {
    loadFriends()
    loadPendingRequests()
  }, [])

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      searchUsers()
    } else {
      setSearchResults([])
    }
  }, [searchQuery, searchUsers])

  const sendFriendRequest = async (userId: number) => {
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/request/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatuses({ ...friendshipStatuses, [userId]: 'pending' })
    } catch (error) {
      console.error('Error sending friend request:', error)
    }
  }

  const acceptFriendRequest = async (userId: number) => {
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/accept/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      loadFriends()
      loadPendingRequests()
    } catch (error) {
      console.error('Error accepting friend request:', error)
    }
  }

  const rejectFriendRequest = async (userId: number) => {
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/reject/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      loadPendingRequests()
    } catch (error) {
      console.error('Error rejecting friend request:', error)
    }
  }

  const cancelFriendRequest = async (userId: number) => {
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/cancel/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatuses({ ...friendshipStatuses, [userId]: 'none' })
    } catch (error) {
      console.error('Error canceling friend request:', error)
    }
  }

  const removeFriend = async (userId: number) => {
    if (!confirm('Are you sure you want to remove this friend?')) return
    
    try {
      const token = localStorage.getItem('token')
      await axios.delete(`${API_URL}/friends/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      loadFriends()
    } catch (error) {
      console.error('Error removing friend:', error)
    }
  }

  const startChat = (friend: Friend) => {
    upsertDirectConversation({
      id: String(friend.id),
      userId: String(friend.id),
      username: friend.username,
      avatar: friend.avatar || null,
      unreadCount: 0,
    })
    setActiveDM(String(friend.id))
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />
      <div className="max-w-6xl mx-auto py-4 sm:py-8 px-4 sm:px-6 safe-area-top safe-area-bottom">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-8">Friends</h1>

        {/* Search Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-md p-4 sm:p-6 mb-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">Find Friends</h2>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by username..."
              className="w-full pl-10 pr-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
            />
          </div>

          {loading && (
            <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Searching...
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((searchUser) => (
                <div key={searchUser.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg min-h-12 sm:min-h-auto">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0">
                      {searchUser.avatar ? (
                        <img src={searchUser.avatar} alt={searchUser.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-semibold text-sm">
                          {searchUser.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white truncate">{searchUser.username}</p>
                      {searchUser.bio && <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">{searchUser.bio}</p>}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-h-10 sm:min-h-auto">
                    <button
                      onClick={() => navigate(`/profile/${searchUser.id}`)}
                      className="px-3 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                    >
                      Profile
                    </button>
                    {friendshipStatuses[searchUser.id] === 'accepted' ? (
                      <span className="px-3 py-2 text-xs sm:text-sm bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg text-center">
                        Friends
                      </span>
                    ) : friendshipStatuses[searchUser.id] === 'pending' ? (
                      <button
                        onClick={() => cancelFriendRequest(searchUser.id)}
                        className="px-3 py-2 text-xs sm:text-sm bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => sendFriendRequest(searchUser.id)}
                        className="flex items-center justify-center gap-1 px-3 py-2 text-xs sm:text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                      >
                        <UserPlusIcon className="w-4 h-4 flex-shrink-0" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-md p-4 sm:p-6 mb-6">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">Friend Requests</h2>
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <div key={request.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 sm:p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0">
                      {request.avatar ? (
                        <img src={request.avatar} alt={request.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-semibold text-lg">
                          {request.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white truncate">{request.username}</p>
                      {request.bio && <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">{request.bio}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 min-h-10 sm:min-h-auto">
                    <button
                      onClick={() => acceptFriendRequest(request.id)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-4 py-2 text-xs sm:text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                      title="Accept"
                    >
                      <CheckIcon className="w-4 h-4 flex-shrink-0" />
                      <span className="sm:hidden">Accept</span>
                    </button>
                    <button
                      onClick={() => rejectFriendRequest(request.id)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-4 py-2 text-xs sm:text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                      title="Reject"
                    >
                      <XMarkIcon className="w-4 h-4 flex-shrink-0" />
                      <span className="sm:hidden">Reject</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-md p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <UserGroupIcon className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
            My Friends ({friends.length})
          </h2>
          {friends.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <UserGroupIcon className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
              <p className="text-sm sm:text-base">You haven't added any friends yet.</p>
              <p className="text-xs sm:text-sm mt-2">Search for users above to add friends!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {friends.map((friend) => (
                <div key={friend.id} className="p-4 sm:p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center gap-3 mb-3 min-w-0">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0">
                      {friend.avatar ? (
                        <img src={friend.avatar} alt={friend.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-semibold text-lg">
                          {friend.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white truncate">{friend.username}</p>
                      {friend.bio && (
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">{friend.bio}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 min-h-10 sm:min-h-[44px]">
                    <button
                      onClick={() => startChat(friend)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs sm:text-sm transition-colors tap-highlight-none"
                    >
                      <ChatBubbleLeftIcon className="w-4 h-4 flex-shrink-0" />
                      <span className="hidden sm:inline">Message</span>
                      <span className="sm:hidden">Chat</span>
                    </button>
                    <button
                      onClick={() => navigate(`/profile/${friend.id}`)}
                      className="flex-1 px-3 py-2 sm:py-1.5 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-300 rounded-lg text-xs sm:text-sm transition-colors tap-highlight-none"
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => removeFriend(friend.id)}
                      className="px-3 py-2 sm:py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs sm:text-sm transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
                      title="Remove Friend"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
