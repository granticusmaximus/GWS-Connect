import { create } from 'zustand'
import { useChatStore } from './chatStore'
import { WEBRTC_ICE_SERVERS } from '../config/runtime'

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

interface PeerEntry {
    pc: RTCPeerConnection
    username: string
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

const peers = new Map<string, PeerEntry>()
let screenTrack: MediaStreamTrack | null = null
let cameraTrack: MediaStreamTrack | null = null
let boundSocket: ReturnType<typeof useChatStore.getState>['socket'] = null

const getSocket = () => useChatStore.getState().socket

const closeAllPeers = () => {
    peers.forEach(({ pc }) => pc.close())
    peers.clear()
}

const createPeerConnection = (
    toUserId: string,
    username: string,
    localStream: MediaStream | null,
    callId: string,
    onTrack: (stream: MediaStream) => void,
) => {
    const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS })

    if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            getSocket()?.emit('call:signal', {
                callId,
                toUserId,
                signal: { type: 'candidate', candidate: event.candidate.toJSON() },
            })
        }
    }

    pc.ontrack = (event) => {
        onTrack(event.streams[0])
    }

    peers.set(toUserId, { pc, username })
    return pc
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
            const localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: withVideo,
            })
            cameraTrack = localStream.getVideoTracks()[0] || null
            if (cameraTrack) {
                cameraTrack.enabled = withVideo
            }

            socket.emit(
                'call:join',
                { chatType, chatId, withVideo },
                (response: { ok: boolean; callId?: string; participants?: Array<{ userId: string; username: string }>; message?: string }) => {
                    if (!response?.ok || !response.callId) {
                        console.error('Failed to join call:', response?.message)
                        localStream.getTracks().forEach((track) => track.stop())
                        set({ isConnecting: false })
                        return
                    }

                    const callId = response.callId
                    set({
                        activeCallId: callId,
                        activeChatType: chatType,
                        activeChatId: chatId,
                        localStream,
                        isCameraOff: !withVideo,
                        isConnecting: false,
                        participants: {},
                    })

                    response.participants?.forEach(({ userId, username }) => {
                        const pc = createPeerConnection(userId, username, localStream, callId, (stream) => {
                            set((state) => ({
                                participants: {
                                    ...state.participants,
                                    [userId]: { userId, username, stream },
                                },
                            }))
                        })

                        set((state) => ({
                            participants: {
                                ...state.participants,
                                [userId]: state.participants[userId] || { userId, username, stream: null },
                            },
                        }))

                        void pc.createOffer().then(async (offer) => {
                            await pc.setLocalDescription(offer)
                            socket.emit('call:signal', {
                                callId,
                                toUserId: userId,
                                signal: { type: 'offer', sdp: offer.sdp },
                            })
                        })
                    })
                },
            )
        } catch (error) {
            console.error('Failed to start call:', error)
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
        const { activeCallId, localStream } = get()
        if (activeCallId) {
            getSocket()?.emit('call:leave', { callId: activeCallId })
        }

        localStream?.getTracks().forEach((track) => track.stop())
        screenTrack?.stop()
        screenTrack = null
        cameraTrack = null
        closeAllPeers()

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
        const { localStream, isMuted } = get()
        localStream?.getAudioTracks().forEach((track) => {
            track.enabled = isMuted
        })
        set({ isMuted: !isMuted })
    },

    toggleCamera: () => {
        const { isCameraOff } = get()
        if (cameraTrack) {
            cameraTrack.enabled = isCameraOff
        }
        set({ isCameraOff: !isCameraOff })
    },

    toggleScreenShare: async () => {
        const { isScreenSharing, activeCallId } = get()
        if (!activeCallId) return

        if (isScreenSharing) {
            screenTrack?.stop()
            screenTrack = null
            if (cameraTrack) {
                peers.forEach(({ pc }) => {
                    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
                    void sender?.replaceTrack(cameraTrack as MediaStreamTrack)
                })
            }
            set({ isScreenSharing: false })
            return
        }

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
            screenTrack = displayStream.getVideoTracks()[0] || null
            if (screenTrack) {
                peers.forEach(({ pc }) => {
                    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
                    void sender?.replaceTrack(screenTrack as MediaStreamTrack)
                })
                screenTrack.onended = () => {
                    void get().toggleScreenShare()
                }
            }
            set({ isScreenSharing: true })
        } catch (error) {
            console.error('Failed to start screen share:', error)
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

        socket.on('call:peer-joined', (payload: { callId: string; userId: string; username: string }) => {
            const { activeCallId, localStream } = get()
            if (!activeCallId || activeCallId !== payload.callId) return
            if (peers.has(payload.userId)) return

            set((state) => ({
                participants: {
                    ...state.participants,
                    [payload.userId]: { userId: payload.userId, username: payload.username, stream: null },
                },
            }))

            createPeerConnection(payload.userId, payload.username, localStream, activeCallId, (stream) => {
                set((state) => ({
                    participants: {
                        ...state.participants,
                        [payload.userId]: { userId: payload.userId, username: payload.username, stream },
                    },
                }))
            })
        })

        socket.on('call:signal', async (payload: { callId: string; fromUserId: string; signal: { type: string; sdp?: string; candidate?: RTCIceCandidateInit } }) => {
            const { activeCallId, localStream } = get()
            if (!activeCallId || activeCallId !== payload.callId) return

            let entry = peers.get(payload.fromUserId)

            if (payload.signal.type === 'offer' && payload.signal.sdp) {
                if (!entry) {
                    const username = get().participants[payload.fromUserId]?.username || 'Unknown'
                    const pc = createPeerConnection(payload.fromUserId, username, localStream, activeCallId, (stream) => {
                        set((state) => ({
                            participants: {
                                ...state.participants,
                                [payload.fromUserId]: { userId: payload.fromUserId, username, stream },
                            },
                        }))
                    })
                    entry = { pc, username }
                }

                await entry.pc.setRemoteDescription({ type: 'offer', sdp: payload.signal.sdp })
                const answer = await entry.pc.createAnswer()
                await entry.pc.setLocalDescription(answer)
                getSocket()?.emit('call:signal', {
                    callId: activeCallId,
                    toUserId: payload.fromUserId,
                    signal: { type: 'answer', sdp: answer.sdp },
                })
            } else if (payload.signal.type === 'answer' && payload.signal.sdp && entry) {
                await entry.pc.setRemoteDescription({ type: 'answer', sdp: payload.signal.sdp })
            } else if (payload.signal.type === 'candidate' && payload.signal.candidate && entry) {
                try {
                    await entry.pc.addIceCandidate(payload.signal.candidate)
                } catch (error) {
                    console.error('Failed to add ICE candidate:', error)
                }
            }
        })

        socket.on('call:peer-left', (payload: { callId: string; userId: string }) => {
            const { activeCallId } = get()
            if (!activeCallId || activeCallId !== payload.callId) return

            peers.get(payload.userId)?.pc.close()
            peers.delete(payload.userId)

            set((state) => {
                const nextParticipants = { ...state.participants }
                delete nextParticipants[payload.userId]
                return { participants: nextParticipants }
            })
        })
    },
}))
