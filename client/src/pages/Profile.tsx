import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { ArrowLeftIcon, CameraIcon, PencilIcon, EyeIcon, UserGroupIcon, Cog6ToothIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import ImageCropperModal from '../components/ImageCropperModal'
import SettingsModal from '../components/SettingsModal'
import Header from '../components/Header'
import axios from 'axios'
import { API_URL } from '../config/runtime'
const DEFAULT_AVATAR_SRC = '/image.png'

interface MutualFriend {
  id: number
  username: string
  avatar?: string
}

interface ProfileUser {
  id: string | number
  username: string
  avatar?: string
  banner?: string
  bio?: string
  role?: 'user' | 'manager' | 'admin'
  interests?: string[]
  socialLinks?: {
    twitter?: string
    github?: string
    linkedin?: string
    website?: string
  }
  contactInfo?: {
    displayEmail?: string
    phone?: string
  }
}

export default function Profile() {
  const { userId, username } = useParams<{ userId?: string; username?: string }>()
  const navigate = useNavigate()
  const { user, updateProfile } = useAuthStore()
  const routeProfileId = userId ?? null
  const routeUsername = username ?? null
  const isOwnProfile =
    (!routeProfileId && !routeUsername) ||
    routeProfileId === String(user?.id) ||
    routeUsername === user?.username

  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view')
  const [mutualFriends, setMutualFriends] = useState<MutualFriend[]>([])
  const [friendshipStatus, setFriendshipStatus] = useState<string>('none')
  const [formData, setFormData] = useState({
    username: user?.username || '',
    bio: user?.bio || '',
    interests: user?.interests?.join(', ') || '',
    twitter: user?.socialLinks?.twitter || '',
    github: user?.socialLinks?.github || '',
    linkedin: user?.socialLinks?.linkedin || '',
    website: user?.socialLinks?.website || '',
    displayEmail: user?.contactInfo?.displayEmail || '',
    phone: user?.contactInfo?.phone || '',
  })

  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(user?.banner || null)
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(isOwnProfile ? (user as ProfileUser | null) : null)
  const [profileLoading, setProfileLoading] = useState<boolean>(!isOwnProfile)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [cropperModal, setCropperModal] = useState<{ isOpen: boolean; type: 'avatar' | 'banner' }>({
    isOpen: false,
    type: 'avatar',
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const resolvedProfileId = !isOwnProfile
    ? profileUser?.id
      ? String(profileUser.id)
      : routeProfileId
    : user?.id
      ? String(user.id)
      : null

  useEffect(() => {
    if ('Notification' in window) {
      setPushPermission(Notification.permission)
    }
  }, [])

  useEffect(() => {
    if (isOwnProfile) {
      setProfileUser((user as ProfileUser | null) || null)
      setProfileLoading(false)
      setProfileError(null)
      return
    }

    if (!routeProfileId && !routeUsername) return

    let isCancelled = false

    const loadViewedProfile = async () => {
      setProfileLoading(true)
      setProfileError(null)
      try {
        const response = await axios.get(
          routeUsername
            ? `${API_URL}/users/profile/username/${encodeURIComponent(routeUsername)}`
            : `${API_URL}/users/profile/${routeProfileId}`,
        )
        if (!isCancelled) {
          setProfileUser(response.data as ProfileUser)
        }
      } catch (error) {
        console.error('Error loading viewed profile:', error)
        if (!isCancelled) {
          setProfileUser(null)
          setProfileError('Unable to load this profile right now.')
        }
      } finally {
        if (!isCancelled) {
          setProfileLoading(false)
        }
      }
    }

    void loadViewedProfile()

    return () => {
      isCancelled = true
    }
  }, [isOwnProfile, routeProfileId, routeUsername, user])

  useEffect(() => {
    const sourceProfile = isOwnProfile ? user : profileUser
    if (!sourceProfile) return

    setFormData({
      username: sourceProfile.username || '',
      bio: sourceProfile.bio || '',
      interests: sourceProfile.interests?.join(', ') || '',
      twitter: sourceProfile.socialLinks?.twitter || '',
      github: sourceProfile.socialLinks?.github || '',
      linkedin: sourceProfile.socialLinks?.linkedin || '',
      website: sourceProfile.socialLinks?.website || '',
      displayEmail: sourceProfile.contactInfo?.displayEmail || '',
      phone: sourceProfile.contactInfo?.phone || '',
    })

    setAvatarPreview(sourceProfile.avatar || null)
    setBannerPreview(sourceProfile.banner || null)

    if (!isOwnProfile) {
      setViewMode('view')
    }
  }, [isOwnProfile, profileUser, user])

  const loadMutualFriends = useCallback(async () => {
    if (!resolvedProfileId) return
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/friends/mutual/${resolvedProfileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setMutualFriends(response.data)
    } catch (error) {
      console.error('Error loading mutual friends:', error)
    }
  }, [resolvedProfileId])

  const loadFriendshipStatus = useCallback(async () => {
    if (!resolvedProfileId) return
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/friends/status/${resolvedProfileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatus(response.data.status || 'none')
    } catch (error) {
      console.error('Error loading friendship status:', error)
    }
  }, [resolvedProfileId])

  useEffect(() => {
    if (!isOwnProfile && resolvedProfileId) {
      loadMutualFriends()
      loadFriendshipStatus()
    }
  }, [resolvedProfileId, isOwnProfile, loadMutualFriends, loadFriendshipStatus])

  const sendFriendRequest = async () => {
    if (!resolvedProfileId) return
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/request/${resolvedProfileId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatus('pending')
    } catch (error) {
      console.error('Error sending friend request:', error)
    }
  }

  const acceptFriendRequest = async () => {
    if (!resolvedProfileId) return
    try {
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/friends/accept/${resolvedProfileId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatus('accepted')
      loadMutualFriends()
    } catch (error) {
      console.error('Error accepting friend request:', error)
    }
  }

  const removeFriend = async () => {
    if (!confirm('Are you sure you want to remove this friend?')) return
    if (!resolvedProfileId) return
    
    try {
      const token = localStorage.getItem('token')
      await axios.delete(`${API_URL}/friends/${resolvedProfileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFriendshipStatus('none')
      loadMutualFriends()
    } catch (error) {
      console.error('Error removing friend:', error)
    }
  }

  const handleAvatarClick = () => {
    setCropperModal({ isOpen: true, type: 'avatar' })
  }

  const handleBannerClick = () => {
    setCropperModal({ isOpen: true, type: 'banner' })
  }

  const handleCropperSave = (croppedImage: string) => {
    if (cropperModal.type === 'avatar') {
      setAvatarPreview(croppedImage)
    } else {
      setBannerPreview(croppedImage)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus(null)
    
    try {
      await updateProfile({
        username: formData.username,
        bio: formData.bio,
        avatar: avatarPreview || undefined,
        banner: bannerPreview || undefined,
        interests: formData.interests.split(',').map(i => i.trim()).filter(Boolean),
        socialLinks: {
          twitter: formData.twitter,
          github: formData.github,
          linkedin: formData.linkedin,
          website: formData.website,
        },
        contactInfo: {
          displayEmail: formData.displayEmail,
          phone: formData.phone,
        },
      })
      setStatus({ type: 'success', message: 'Profile updated successfully!' })
      setTimeout(() => setStatus(null), 5000)
    } catch (error) {
      console.error('Profile update error:', error)
      setStatus({ type: 'error', message: 'Failed to update profile. Please try again.' })
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const activeProfile = (isOwnProfile ? user : profileUser) as ProfileUser | null
  const displayName = activeProfile?.username || 'Unknown User'
  const displayAvatar = avatarPreview || activeProfile?.avatar || DEFAULT_AVATAR_SRC
  const displayBanner = bannerPreview || activeProfile?.banner || ''
  const displayInterests = activeProfile?.interests || []
  const displaySocialLinks = activeProfile?.socialLinks || {}
  const displayContactInfo = activeProfile?.contactInfo || {}

  const hasProfileInfo =
    Boolean(activeProfile?.bio?.trim()) ||
    displayInterests.length > 0 ||
    Object.values(displaySocialLinks).some((value) => Boolean(value?.trim())) ||
    Boolean(displayContactInfo.displayEmail?.trim()) ||
    Boolean(displayContactInfo.phone?.trim())

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />
      <div className="max-w-4xl mx-auto py-4 sm:py-8 px-4 sm:px-6 safe-area-top safe-area-bottom">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center text-sm sm:text-base text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 min-h-12 px-3 tap-highlight-none transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-2" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {isOwnProfile && (
              <>
                <div className="group relative">
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-3 sm:p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors min-h-12 min-w-12 sm:min-h-auto sm:min-w-auto flex items-center justify-center tap-highlight-none"
                    title="Settings"
                  >
                    <Cog6ToothIcon className="w-5 h-5" />
                  </button>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Settings
                  </span>
                </div>
                {user?.role === 'admin' && (
                  <button
                    onClick={() => navigate('/admin')}
                    className="flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-2 min-h-12 sm:min-h-auto bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium text-sm tap-highlight-none"
                    title="Admin Panel"
                  >
                    <ShieldCheckIcon className="w-5 h-5" />
                    <span className="hidden sm:inline">Admin Panel</span>
                    <span className="sm:hidden">Admin</span>
                  </button>
                )}
              </>
            )}

            {isOwnProfile && (
              <button
                onClick={() => setViewMode(viewMode === 'view' ? 'edit' : 'view')}
                className="flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-2 min-h-12 sm:min-h-auto bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium text-sm tap-highlight-none"
              >
                {viewMode === 'view' ? (
                  <>
                    <PencilIcon className="w-5 h-5" />
                    <span className="hidden sm:inline">Edit Profile</span>
                    <span className="sm:hidden">Edit</span>
                  </>
                ) : (
                  <>
                    <EyeIcon className="w-5 h-5" />
                    <span className="hidden sm:inline">View Profile</span>
                    <span className="sm:hidden">View</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {profileLoading ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl p-8 text-center text-gray-600 dark:text-gray-300">
            Loading profile...
          </div>
        ) : profileError ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl p-8 text-center text-red-600 dark:text-red-400">
            {profileError}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl overflow-hidden">
            {/* Banner */}
            <div className="relative h-32 sm:h-48 bg-gradient-to-r from-primary-600 to-primary-800 group">
            {displayBanner && (
              <img src={displayBanner} alt="Banner" className="w-full h-full object-cover" />
            )}
            {isOwnProfile && viewMode === 'edit' && (
              <button
                type="button"
                onClick={handleBannerClick}
                className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                title="Upload banner image"
                aria-label="Upload banner image"
              >
                <div className="bg-white dark:bg-gray-800 rounded-full p-2 sm:p-3">
                  <CameraIcon className="w-6 h-6 sm:w-6 sm:h-6 text-gray-900 dark:text-white" />
                </div>
              </button>
            )}
          </div>

          {/* Profile Picture */}
          <div className="px-4 sm:px-6 pb-6 sm:pb-6">
            <div className="flex items-end -mt-12 sm:-mt-16 mb-6">
              <div className="relative group">
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white dark:border-gray-800 bg-gray-300 dark:bg-gray-600 overflow-hidden flex-shrink-0">
                  <img src={displayAvatar} alt={displayName} className="w-full h-full object-cover" />
                </div>
                {isOwnProfile && viewMode === 'edit' && (
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="absolute inset-0 rounded-full bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                    title="Upload profile picture"
                    aria-label="Upload profile picture"
                  >
                    <CameraIcon className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                  </button>
                )}
              </div>
            </div>

            {isOwnProfile && viewMode === 'edit' ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                {status && (
                  <div className={`p-4 rounded-md ${status.type === 'success' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100' : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100'}`}>
                    {status.message}
                  </div>
                )}

                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleChange}
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Bio
                  </label>
                  <textarea
                    name="bio"
                    value={formData.bio}
                    onChange={handleChange}
                    rows={4}
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                    placeholder="Tell us about yourself..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Interests (comma-separated)
                  </label>
                  <input
                    type="text"
                    name="interests"
                    value={formData.interests}
                    onChange={handleChange}
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                    placeholder="Gaming, Music, Art"
                  />
                </div>

                <div className="space-y-4">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Social Links</h3>
                  <input
                    type="text"
                    name="twitter"
                    value={formData.twitter}
                    onChange={handleChange}
                    placeholder="Twitter Username"
                    aria-label="Twitter Username"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                  <input
                    type="text"
                    name="github"
                    value={formData.github}
                    onChange={handleChange}
                    placeholder="GitHub Username"
                    aria-label="GitHub Username"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                  <input
                    type="text"
                    name="linkedin"
                    value={formData.linkedin}
                    onChange={handleChange}
                    placeholder="LinkedIn Username"
                    aria-label="LinkedIn Username"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                  <input
                    type="text"
                    name="website"
                    value={formData.website}
                    onChange={handleChange}
                    placeholder="Website URL"
                    aria-label="Website URL"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                </div>

                <div className="space-y-4">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Contact Information</h3>
                  <input
                    type="email"
                    name="displayEmail"
                    value={formData.displayEmail}
                    onChange={handleChange}
                    placeholder="Public Email"
                    aria-label="Public Email"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="Phone Number"
                    aria-label="Phone Number"
                    className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-12 py-3 sm:py-2 px-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg sm:rounded-md transition-colors tap-highlight-none"
                >
                  Save Profile
                </button>
              </form>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white break-words">
                    {displayName}
                  </h1>
                  
                  {!isOwnProfile && (
                    <div>
                      {friendshipStatus === 'none' && (
                        <button
                          onClick={sendFriendRequest}
                          className="w-full sm:w-auto min-h-12 sm:min-h-auto px-4 py-3 sm:py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg sm:rounded-md transition-colors text-sm sm:text-base tap-highlight-none"
                        >
                          Add Friend
                        </button>
                      )}
                      {friendshipStatus === 'pending' && (
                        <div className="w-full sm:w-auto min-h-12 sm:min-h-auto px-4 py-3 sm:py-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-medium rounded-lg sm:rounded-md flex items-center justify-center text-sm sm:text-base">
                          Request Sent
                        </div>
                      )}
                      {friendshipStatus === 'pending_incoming' && (
                        <button
                          onClick={acceptFriendRequest}
                          className="w-full sm:w-auto min-h-12 sm:min-h-auto px-4 py-3 sm:py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg sm:rounded-md transition-colors text-sm sm:text-base tap-highlight-none"
                        >
                          Accept Friend Request
                        </button>
                      )}
                      {friendshipStatus === 'accepted' && (
                        <button
                          onClick={removeFriend}
                          className="w-full sm:w-auto min-h-12 sm:min-h-auto px-4 py-3 sm:py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-900 dark:text-white font-medium rounded-lg sm:rounded-md transition-colors text-sm sm:text-base tap-highlight-none"
                        >
                          Unfriend
                        </button>
                      )}
                    </div>
                  )}
                </div>
                
                {activeProfile?.bio && (
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Bio</h3>
                    <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300 break-words">{activeProfile.bio}</p>
                  </div>
                )}

                {displayInterests.length > 0 && (
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Interests</h3>
                    <div className="flex flex-wrap gap-2">
                      {displayInterests.map((interest, index) => (
                        <span
                          key={index}
                          className="px-3 py-1.5 sm:py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs sm:text-sm"
                        >
                          {interest}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Object.values(displaySocialLinks).some(link => link) && (
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Social Links</h3>
                    <div className="space-y-2 text-sm sm:text-base">
                      {displaySocialLinks.twitter && (
                        <a
                          href={`https://twitter.com/${displaySocialLinks.twitter}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 break-all"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">Twitter:</span>
                          @{displaySocialLinks.twitter}
                        </a>
                      )}
                      {displaySocialLinks.github && (
                        <a
                          href={`https://github.com/${displaySocialLinks.github}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 break-all"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">GitHub:</span>
                          @{displaySocialLinks.github}
                        </a>
                      )}
                      {displaySocialLinks.linkedin && (
                        <a
                          href={`https://linkedin.com/in/${displaySocialLinks.linkedin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 break-all"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">LinkedIn:</span>
                          {displaySocialLinks.linkedin}
                        </a>
                      )}
                      {displaySocialLinks.website && (
                        <a
                          href={displaySocialLinks.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 break-all"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">Website:</span>
                          {displaySocialLinks.website}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {(displayContactInfo.displayEmail || displayContactInfo.phone) && (
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Contact</h3>
                    <div className="space-y-2 text-sm sm:text-base">
                      {displayContactInfo.displayEmail && (
                        <a
                          href={`mailto:${displayContactInfo.displayEmail}`}
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 break-all"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">Email:</span>
                          {displayContactInfo.displayEmail}
                        </a>
                      )}
                      {displayContactInfo.phone && (
                        <a
                          href={`tel:${displayContactInfo.phone}`}
                          className="flex items-center text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
                        >
                          <span className="font-medium mr-2 flex-shrink-0">Phone:</span>
                          {displayContactInfo.phone}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {!hasProfileInfo && (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    This user has not filled out their profile info yet.
                  </div>
                )}

                {!isOwnProfile && mutualFriends.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <UserGroupIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        Mutual Friends ({mutualFriends.length})
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                      {mutualFriends.map((friend) => (
                        <div
                          key={friend.id}
                          onClick={() => navigate(`/profile/${friend.id}`)}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 sm:p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors min-h-12 sm:min-h-auto justify-center sm:justify-start"
                        >
                          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex-shrink-0 mx-auto sm:mx-0">
                            <img
                              src={friend.avatar || DEFAULT_AVATAR_SRC}
                              alt={friend.username}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate text-center sm:text-left">
                            {friend.username}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
      )}

      {/* Image Cropper Modal */}
      <ImageCropperModal
        isOpen={cropperModal.isOpen}
        onClose={() => setCropperModal({ ...cropperModal, isOpen: false })}
        onSave={handleCropperSave}
        aspectRatio={cropperModal.type}
        title={cropperModal.type === 'avatar' ? 'Crop Profile Picture' : 'Crop Banner Image'}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        pushPermission={pushPermission}
      />
    </div>
    </div>
  )
}
