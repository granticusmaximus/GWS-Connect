import { marked } from 'marked'
import DOMPurify, { type Config } from 'dompurify'

marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    link(href: string, title: string | null | undefined, text: string): string {
      const safeHref = href ? encodeURI(decodeURI(href)) : '#'
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's',
    'code', 'pre',
    'ul', 'ol', 'li',
    'blockquote',
    'h1', 'h2', 'h3',
    'hr', 'a', 'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
}

/** Full block-level markdown: paragraphs, code fences, lists, headings. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string, PURIFY_CONFIG) as string
}

/** Inline-only markdown: bold, italic, inline code, strikethrough. Used within text
 *  segments that are interleaved with @mention React components. */
export function renderMarkdownInline(text: string): string {
  return DOMPurify.sanitize(marked.parseInline(text) as string, PURIFY_CONFIG) as string
}
