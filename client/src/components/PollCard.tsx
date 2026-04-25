import { useMemo, useState, useEffect } from 'react'
import axios from 'axios'
import { API_URL } from '../config/runtime'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { usePreferencesStore } from '../store/preferencesStore'
import { formatDateTime } from '../utils/dateFormat'

interface PollVoter {
  id: number
  username: string
  avatar?: string
}

interface PollOption {
  id: string
  text: string
  count: number
  voters?: PollVoter[]
}

interface PollData {
  id: string
  question: string
  createdBy: number
  expiresAt?: string | null
  createdAt?: string
  options: PollOption[]
  userVoteOptionId?: string | null
}

interface PollCardProps {
  poll: PollData
}

export default function PollCard({ poll }: PollCardProps) {
  const user = useAuthStore((state) => state.user)
  const voteOnPoll = useChatStore((state) => state.voteOnPoll)
  const timeFormat = usePreferencesStore((state) => state.timeFormat)
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const [votersByOption, setVotersByOption] = useState<Record<string, PollVoter[]>>({})

  const isCreator = !!user && String(user.id) === String(poll.createdBy)
  const isExpired = poll.expiresAt ? Date.now() > new Date(poll.expiresAt).getTime() : false

  const totalVotes = useMemo(
    () => poll.options.reduce((sum, option) => sum + option.count, 0),
    [poll.options]
  )

  useEffect(() => {
    if (!isCreator) return
    const token = localStorage.getItem('token')
    if (!token) return

    axios
      .get(`${API_URL}/polls/${poll.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        const options = response.data?.options || []
        const grouped = options.reduce((acc: Record<string, PollVoter[]>, option: PollOption) => {
          acc[option.id] = option.voters || []
          return acc
        }, {})
        setVotersByOption(grouped)
      })
      .catch(() => {})
  }, [isCreator, poll.id])

  return (
    <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{poll.question}</h4>
        {poll.expiresAt && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {isExpired ? 'Poll ended' : `Ends ${formatDateTime(new Date(poll.expiresAt), dateFormat, timeFormat)}`}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const percent = totalVotes > 0 ? Math.round((option.count / totalVotes) * 100) : 0
          const isSelected = poll.userVoteOptionId === option.id
          const voters = votersByOption[option.id] || option.voters || []

          return (
            <div key={option.id} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                type="button"
                onClick={() => voteOnPoll(poll.id, option.id)}
                disabled={isExpired}
                className={`w-full px-3 py-2 text-left transition ${
                  isSelected
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800'
                    : 'bg-white dark:bg-gray-900'
                } ${isExpired ? 'cursor-not-allowed opacity-70' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-900 dark:text-white">{option.text}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{option.count} • {percent}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-2 rounded-full bg-primary-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </button>

              {isCreator && voters.length > 0 && (
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Voters</div>
                  <div className="flex flex-wrap gap-2">
                    {voters.map((voter) => (
                      <div key={voter.id} className="flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 px-2 py-1">
                        {voter.avatar ? (
                          <img src={voter.avatar} alt={voter.username} className="w-4 h-4 rounded-full" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-primary-500 text-[10px] text-white flex items-center justify-center">
                            {voter.username[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs text-gray-700 dark:text-gray-200">{voter.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {totalVotes} total vote{totalVotes === 1 ? '' : 's'}
      </div>
    </div>
  )
}
