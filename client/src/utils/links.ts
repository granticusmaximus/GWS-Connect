export const extractFirstUrl = (content: string) => {
  const match = String(content || '').match(/https?:\/\/[^\s<>()]+/i)
  return match?.[0] || null
}
