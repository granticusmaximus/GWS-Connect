import { create } from 'zustand'
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client'
import { useChatStore } from './chatStore'

export interface CallParticipant {
    userId: string
    username: string
    stream: MediaStream | null
}

export interface IncomingCall {
    callId: string
    chatType: 'channel' | 'dm' | 'group'
    chatId: string
    fromUserId: string
    fromUsername: string
    withVideo: boolean
}

interface CallState {
    activeCallId: string | null
    activeChatType: 'channel' | 'dm' | 'group' | 'voice' | null
    activeChatId: string | null
    localStream: MediaStream | null
    participants: Record<string, CallParticipant>
    incomingCall: IncomingCall | null
    isMuted: boolean
    isCameraOff: boolean
    isScreenSharing: boolean
    isConnecting: boolean
    startCall: (chatType: 'channel' | 'dm' | 'group' | 'voice', chatId: string, withVideo: boolean) => Promise<void>
    acceptIncomingCall: () => Promise<void>
    declineIncomingCall: () => void
    leaveCall: () => void
    toggleMute: () => void
    toggleCamera: () => void
    toggleScreenShare: () => Promise<void>
    registerSocketListeners: () => void
}

interface CallJoinResponse {
    ok: boolean
    callId?: string
    participants?: Array<{ userId: string; username: string }>
    livekitUrl?: string
    livekitToken?: string
    message?: string
}

let liveKitRoom: Room | null = null
let boundSocket: ReturnType<typeof useChatStore.getState>['socket'] = null
const callDebugEnabled = import.meta.env.DEV || import.meta.env.VITE_CALL_DEBUG === 'true'

const logCallDebug = (...args: unknown[]) => {
    if (!callDebugEnabled) {
        return
    }

    console.debug('[call]', ...args)
}

const getSocket = () => useChatStore.getState().socket

// LiveKit gives us per-track RemoteTrack objects rather than a single
// MediaStream per participant - rebuild one so CallBar's existing
// <video srcObject> tiles don't need to know anything changed underneath.
const streamsByParticipant = new Map<string, MediaStream>()

const getOrCreateParticipantStream = (identity: string) => {
    let stream = streamsByParticipant.get(identity)
    if (!stream) {
        stream = new MediaStream()
        streamsByParticipant.set(identity, stream)
    }
    return stream
}

const buildLocalStream = (room: Room) => {
    const stream = new MediaStream()
    const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    if (micTrack?.mediaStreamTrack) stream.addTrack(micTrack.mediaStreamTrack)
    if (camTrack?.mediaStreamTrack) stream.addTrack(camTrack.mediaStreamTrack)
    return stream
}

const teardownRoom = () => {
    liveKitRoom?.removeAllListeners()
    liveKitRoom = null
    streamsByParticipant.clear()
}

export const useCallStore = create<CallState>((set, get) => ({
    activeCallId: null,
    activeChatType: null,
    activeChatId: null,
    localStream: null,
    participants: {},
    incomingCall: null,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    isConnecting: false,

    startCall: async (chatType, chatId, withVideo) => {
        const socket = getSocket()
        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return
        }

        if (get().activeCallId) {
            get().leaveCall()
        }

        set({ isConnecting: true })

        try {
            const response = await new Promise<CallJoinResponse>((resolve) => {
                socket.emit('call:join', { chatType, chatId, withVideo }, resolve)
            })

            if (!response?.ok || !response.callId || !response.livekitUrl || !response.livekitToken) {
                console.error('Failed to join call:', response?.message)
                set({ isConnecting: false })
                return
            }

            const { callId, livekitUrl, livekitToken } = response
            const room = new Room()
            liveKitRoom = room

            const upsertParticipant = (userId: string, username: string) => {
                set((state) => ({
                    participants: {
                        ...state.participants,
                        [userId]: state.participants[userId]
                            ? { ...state.participants[userId], username }
                            : { userId, username, stream: null },
                    },
                }))
            }

            room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
                logCallDebug('participant-connected', { identity: participant.identity })
                upsertParticipant(participant.identity, participant.name || participant.identity)
            })

            room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
                logCallDebug('participant-disconnected', { identity: participant.identity })
                streamsByParticipant.delete(participant.identity)
                set((state) => {
                    const nextParticipants = { ...state.participants }
                    delete nextParticipants[participant.identity]
                    return { participants: nextParticipants }
                })
            })

            room.on(
                RoomEvent.TrackSubscribed,
                (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
                    logCallDebug('track-subscribed', { identity: participant.identity, kind: track.kind })
                    const stream = getOrCreateParticipantStream(participant.identity)
                    stream.addTrack(track.mediaStreamTrack)
                    set((state) => ({
                        participants: {
                            ...state.participants,
                            [participant.identity]: {
                                userId: participant.identity,
                                username: participant.name || participant.identity,
                                stream,
                            },
                        },
                    }))
                },
            )

            room.on(
                RoomEvent.TrackUnsubscribed,
                (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
                    logCallDebug('track-unsubscribed', { identity: participant.identity, kind: track.kind })
                    streamsByParticipant.get(participant.identity)?.removeTrack(track.mediaStreamTrack)
                },
            )

            room.on(RoomEvent.Disconnected, () => {
                logCallDebug('room-disconnected')
                if (get().activeCallId === callId) {
                    get().leaveCall()
                }
            })

            await room.connect(livekitUrl, livekitToken)
            await room.localParticipant.setMicrophoneEnabled(true)
            if (withVideo) {
                await room.localParticipant.setCameraEnabled(true)
            }

            const localStream = buildLocalStream(room)

            set({
                activeCallId: callId,
                activeChatType: chatType,
                activeChatId: chatId,
                localStream,
                isCameraOff: !withVideo,
                isConnecting: false,
                participants: {},
            })

            // Seed placeholders from our own session bookkeeping (participants
            // who joined via the socket call:join room before us) so tiles
            // show up immediately - LiveKit's TrackSubscribed events fill in
            // the actual stream for each as they arrive.
            response.participants?.forEach(({ userId, username }) => upsertParticipant(userId, username))
        } catch (error) {
            console.error('Failed to start call:', error)
            teardownRoom()
            set({ isConnecting: false })
        }
    },

    acceptIncomingCall: async () => {
        const incoming = get().incomingCall
        if (!incoming) return
        set({ incomingCall: null })
        await get().startCall(incoming.chatType, incoming.chatId, incoming.withVideo)
    },

    declineIncomingCall: () => {
        const incoming = get().incomingCall
        if (!incoming) return
        getSocket()?.emit('call:decline', { callId: incoming.callId, toUserId: incoming.fromUserId })
        set({ incomingCall: null })
    },

    leaveCall: () => {
        const { activeCallId } = get()
        if (activeCallId) {
            getSocket()?.emit('call:leave', { callId: activeCallId })
        }

        void liveKitRoom?.disconnect()
        teardownRoom()

        set({
            activeCallId: null,
            activeChatType: null,
            activeChatId: null,
            localStream: null,
            participants: {},
            isMuted: false,
            isCameraOff: false,
            isScreenSharing: false,
        })
    },

    toggleMute: () => {
        const { isMuted } = get()
        void liveKitRoom?.localParticipant.setMicrophoneEnabled(isMuted)
        set({ isMuted: !isMuted })
    },

    toggleCamera: () => {
        const { isCameraOff } = get()
        void liveKitRoom?.localParticipant.setCameraEnabled(isCameraOff)
        set({ isCameraOff: !isCameraOff })
    },

    toggleScreenShare: async () => {
        const { isScreenSharing, activeCallId } = get()
        if (!activeCallId || !liveKitRoom) return

        try {
            await liveKitRoom.localParticipant.setScreenShareEnabled(!isScreenSharing)
            set({ isScreenSharing: !isScreenSharing })
        } catch (error) {
            console.error('Failed to toggle screen share:', error)
        }
    },

    registerSocketListeners: () => {
        const socket = getSocket()
        if (!socket || socket === boundSocket) return
        boundSocket = socket

        socket.on('call:incoming', (payload: IncomingCall) => {
            if (get().activeCallId) return
            set({ incomingCall: payload })
        })

        socket.on('call:declined', () => {
            set({ incomingCall: null })
        })
    },
}))
