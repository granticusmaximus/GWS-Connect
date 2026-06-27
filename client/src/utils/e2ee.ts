import axios from 'axios'
import { API_URL } from '../config/runtime'

const publicKeyCache = new Map<string, JsonWebKey>()
const sharedKeyCache = new Map<string, CryptoKey>()
const groupKeyCache = new Map<string, CryptoKey>()
const channelKeyCache = new Map<string, CryptoKey>()

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64 = (buffer: ArrayBuffer) => {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

const fromBase64 = (value: string) => {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
}

export const generateIdentityKeyPair = async () => {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits'],
    )

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

    return { publicKeyJwk, privateKeyJwk }
}

const derivePasswordKey = async (password: string, salt: ArrayBuffer) => {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
    )

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 120000,
            hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )
}

export const encryptPrivateKeyJwk = async (privateKeyJwk: JsonWebKey, password: string) => {
    const salt = crypto.getRandomValues(new Uint8Array(16)).buffer
    const iv = crypto.getRandomValues(new Uint8Array(12)).buffer
    const key = await derivePasswordKey(password, salt)
    const payload = encoder.encode(JSON.stringify(privateKeyJwk))

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        payload,
    )

    return {
        encryptedPrivateKey: toBase64(encrypted),
        salt: toBase64(salt),
        iv: toBase64(iv),
    }
}

export const decryptPrivateKeyJwk = async (
    encryptedPrivateKey: string,
    password: string,
    salt: string,
    iv: string,
) => {
    const key = await derivePasswordKey(password, fromBase64(salt))
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) },
        key,
        fromBase64(encryptedPrivateKey),
    )

    return JSON.parse(decoder.decode(decrypted)) as JsonWebKey
}

export const importPrivateKey = async (privateKeyJwk: JsonWebKey) =>
    crypto.subtle.importKey(
        'jwk',
        privateKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey', 'deriveBits'],
    )

const importPublicKey = async (publicKeyJwk: JsonWebKey) =>
    crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    )

export const getUserPublicKey = async (userId: string) => {
    if (publicKeyCache.has(userId)) {
        return publicKeyCache.get(userId) as JsonWebKey
    }

    const response = await axios.get(`${API_URL}/users/public-key/${userId}`)
    const key = response.data.e2eePublicKey as JsonWebKey
    publicKeyCache.set(userId, key)
    return key
}

export const getSharedKey = async (
    privateKey: CryptoKey,
    peerUserId: string,
) => {
    if (sharedKeyCache.has(peerUserId)) {
        return sharedKeyCache.get(peerUserId) as CryptoKey
    }

    const peerPublicJwk = await getUserPublicKey(peerUserId)
    const peerPublicKey = await importPublicKey(peerPublicJwk)

    const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerPublicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )

    sharedKeyCache.set(peerUserId, sharedKey)
    return sharedKey
}

export const encryptMessage = async (plaintext: string, sharedKey: CryptoKey) => {
    const iv = crypto.getRandomValues(new Uint8Array(12)).buffer
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        sharedKey,
        encoder.encode(plaintext),
    )

    return {
        cipherText: toBase64(cipher),
        iv: toBase64(iv),
    }
}

export const decryptMessage = async (
    cipherText: string,
    iv: string,
    sharedKey: CryptoKey,
) => {
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) },
        sharedKey,
        fromBase64(cipherText),
    )

    return decoder.decode(plaintext)
}

// Like encryptMessage/decryptMessage, but for raw bytes (e.g. file uploads)
// rather than text - the ciphertext stays as an ArrayBuffer instead of being
// base64-encoded, since it can be arbitrarily large (avoids ~33% bloat from
// base64-encoding a whole file body). Only the IV is a transportable string.
export const encryptBytes = async (data: ArrayBuffer, key: CryptoKey) => {
    const iv = crypto.getRandomValues(new Uint8Array(12)).buffer
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        data,
    )

    return {
        cipher,
        iv: toBase64(iv),
    }
}

export const decryptBytes = async (cipher: ArrayBuffer, iv: string, key: CryptoKey) => {
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) },
        key,
        cipher,
    )
}

export const generateGroupKey = async () =>
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

const exportRawKey = async (key: CryptoKey) => {
    const raw = await crypto.subtle.exportKey('raw', key)
    return toBase64(raw)
}

const importRawKey = async (base64Key: string) =>
    crypto.subtle.importKey(
        'raw',
        fromBase64(base64Key),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )

export const wrapGroupKeyForMember = async (
    groupKey: CryptoKey,
    privateKey: CryptoKey,
    memberUserId: string,
) => {
    const rawKeyBase64 = await exportRawKey(groupKey)
    const sharedKey = await getSharedKey(privateKey, memberUserId)
    const wrapped = await encryptMessage(rawKeyBase64, sharedKey)
    return { wrappedKey: wrapped.cipherText, wrappedIv: wrapped.iv }
}

const unwrapGroupKey = async (
    wrappedKey: string,
    wrappedIv: string,
    privateKey: CryptoKey,
    wrappedByUserId: string,
) => {
    const sharedKey = await getSharedKey(privateKey, wrappedByUserId)
    const rawKeyBase64 = await decryptMessage(wrappedKey, wrappedIv, sharedKey)
    return importRawKey(rawKeyBase64)
}

export const getGroupKey = async (
    groupChatId: string,
    privateKey: CryptoKey,
) => {
    if (groupKeyCache.has(groupChatId)) {
        return groupKeyCache.get(groupChatId) as CryptoKey
    }

    const response = await axios.get(`${API_URL}/group-chats/${groupChatId}/keys/me`)
    const { wrappedKey, wrappedIv, wrappedByUserId } = response.data
    const groupKey = await unwrapGroupKey(wrappedKey, wrappedIv, privateKey, String(wrappedByUserId))

    groupKeyCache.set(groupChatId, groupKey)
    return groupKey
}

export const cacheGroupKey = (groupChatId: string, groupKey: CryptoKey) => {
    groupKeyCache.set(groupChatId, groupKey)
}

export const getChannelKey = async (
    channelId: string,
    privateKey: CryptoKey,
) => {
    if (channelKeyCache.has(channelId)) {
        return channelKeyCache.get(channelId) as CryptoKey
    }

    const response = await axios.get(`${API_URL}/channels/${channelId}/keys/me`)
    const { wrappedKey, wrappedIv, wrappedByUserId } = response.data
    const channelKey = await unwrapGroupKey(wrappedKey, wrappedIv, privateKey, String(wrappedByUserId))

    channelKeyCache.set(channelId, channelKey)
    return channelKey
}

export const cacheChannelKey = (channelId: string, channelKey: CryptoKey) => {
    channelKeyCache.set(channelId, channelKey)
}

export const clearE2eeCache = () => {
    publicKeyCache.clear()
    sharedKeyCache.clear()
    groupKeyCache.clear()
    channelKeyCache.clear()
}
