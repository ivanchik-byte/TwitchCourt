export interface ParsedAISnippet {
  baseUrl?: string
  apiKey?: string
  model?: string
  extraBody?: Record<string, unknown>
  temperature?: number
}

// balanced object scan: regex can't handle nested braces like
// extra_body={"provider": {"service_tier": "standard"}}
function scanObject(src: string, from: number): string | null {
  const start = src.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

function pyToJson(obj: string): unknown {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < obj.length; i++) {
    const ch = obj[i]
    if (quote) {
      if (ch === '\\' && i + 1 < obj.length) {
        out += ch + obj[i + 1]
        i++
      } else if (ch === quote) {
        out += '"'
        quote = null
      } else {
        out += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += '"'
      continue
    }
    out += ch
  }
  out = out
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
  return JSON.parse(out)
}

const STANDARD_BODY = new Set(['model', 'messages', 'temperature', 'stream'])

export function parseAISnippet(input: string): ParsedAISnippet {
  const result: ParsedAISnippet = {}
  const raw = input.trim()
  if (!raw) return result

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      if (typeof obj.base_url === 'string') result.baseUrl = obj.base_url
      else if (typeof obj.baseURL === 'string') result.baseUrl = obj.baseURL
      if (typeof obj.api_key === 'string') result.apiKey = obj.api_key
      else if (typeof obj.apiKey === 'string') result.apiKey = obj.apiKey
      if (typeof obj.model === 'string') result.model = obj.model
      if (typeof obj.temperature === 'number') result.temperature = obj.temperature
      if (obj.extra_body && typeof obj.extra_body === 'object') {
        result.extraBody = obj.extra_body as Record<string, unknown>
      }
      return result
    } catch {
      /* not plain JSON, try SDK formats below */
    }
  }

  const baseUrl = raw.match(/base_url\s*=\s*["']([^"']+)["']/i)
  if (baseUrl) result.baseUrl = baseUrl[1]
  const apiKey = raw.match(/api_key\s*=\s*["']([^"']+)["']/i)
  if (apiKey && !apiKey[1].includes('<') && !apiKey[1].startsWith('os.') && !apiKey[1].includes('environ')) {
    result.apiKey = apiKey[1]
  }
  const model = raw.match(/model\s*=\s*["']([^"']+)["']/i)
  if (model) result.model = model[1]
  const temp = raw.match(/temperature\s*=\s*([0-9.]+)/i)
  if (temp) result.temperature = parseFloat(temp[1])

  const extraPos = raw.search(/extra_body\s*=/i)
  if (extraPos >= 0) {
    const obj = scanObject(raw, extraPos)
    if (obj) {
      try {
        const parsed = pyToJson(obj)
        if (parsed && typeof parsed === 'object') {
          result.extraBody = parsed as Record<string, unknown>
        }
      } catch {
        /* keep what we already parsed */
      }
    }
  }

  if (raw.includes('curl')) {
    const url = raw.match(/curl\s+(?:-[^\s]+\s+)*["']?(https?:\/\/[^\s"']+)["']?/i)
    if (url) result.baseUrl = url[1]
    const auth = raw.match(/-H\s+["']Authorization:\s*Bearer\s+([^"'\s]+)["']/i)
    if (auth && !auth[1].includes('<')) result.apiKey = auth[1]
    const bodyPos = raw.search(/-d\s+['"]|--data(?:-binary)?\s+['"]/i)
    if (bodyPos >= 0) {
      const obj = scanObject(raw, bodyPos)
      if (obj) {
        try {
          const bodyObj = JSON.parse(obj) as Record<string, unknown>
          if (typeof bodyObj.model === 'string') result.model = bodyObj.model
          if (typeof bodyObj.temperature === 'number') result.temperature = bodyObj.temperature
          const extra: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(bodyObj)) {
            if (!STANDARD_BODY.has(k)) extra[k] = v
          }
          if (Object.keys(extra).length > 0) result.extraBody = extra
        } catch {
          /* keep what we already parsed */
        }
      }
    }
  }

  if (result.baseUrl) {
    result.baseUrl = result.baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '')
  }
  return result
}
