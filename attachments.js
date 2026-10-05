/**
 * 对话附件识别模块 —— 纯函数、无 IO、无副作用，可独立测试。
 *
 * 数据来源（两条，统一到同一条附件记录模型）：
 *   A. DSH 上传附件：消息 content 内的 `{ type:'image'|'file', attachment:{...} }` 块
 *      - 图片 ref: { attachmentId:'sha256:<hex>', mediaType, width, height, bytes, name?, originalDimensions? }
 *      - 文件 ref: { attachmentId:'sha256:<hex>', name, bytes }
 *   B. 交付物：`deliverables/presented` 事件的 `data.files[] = { path, description }`
 *
 * 已知降级（已与用户确认）：
 *   - 消息ID：DSH 无稳定消息 ID，降级为所属事件的 `seq`
 *   - 上传时间：附件自身无时间字段，降级为所属事件的 `time`（标记 timeSource:'event'）
 *   - 图片可无文件名，降级为 `附件-<sha 前 8 位>` 占位
 */

/** 附件类型：首期 5 类 + 未知。 */
export const ATTACHMENT_KINDS = Object.freeze({
  DOCUMENT: 'document',
  IMAGE: 'image',
  ARCHIVE: 'archive',
  VIDEO: 'video',
  AUDIO: 'audio',
  LINK: 'link',
  UNKNOWN: 'unknown',
})

/** 类型 → 界面字样。集中定义，避免散落字面量。 */
export const KIND_LABELS = Object.freeze({
  [ATTACHMENT_KINDS.DOCUMENT]: '文档',
  [ATTACHMENT_KINDS.IMAGE]: '图片',
  [ATTACHMENT_KINDS.ARCHIVE]: '压缩包',
  [ATTACHMENT_KINDS.VIDEO]: '视频',
  [ATTACHMENT_KINDS.AUDIO]: '音频',
  [ATTACHMENT_KINDS.LINK]: '链接',
  [ATTACHMENT_KINDS.UNKNOWN]: '附件',
})

/** 记录来源，用于卡片降级展示与排查。 */
export const ATTACHMENT_SOURCES = Object.freeze({
  IMAGE_BLOCK: 'image',
  FILE_BLOCK: 'file',
  DELIVERABLE: 'deliverable',
})

/** 扩名 → 类型。键一律小写、不含点。 */
const EXTENSION_KINDS = Object.freeze({
  // 文档
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', md: 'document', csv: 'document',
  json: 'document', xml: 'document', yaml: 'document', yml: 'document', rtf: 'document',
  odt: 'document', ods: 'document', odp: 'document', html: 'document', htm: 'document',
  // 图片
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image',
  svg: 'image', tif: 'image', tiff: 'image', avif: 'image', heic: 'image', ico: 'image',
  // 压缩包
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', zst: 'archive', tgz: 'archive', cab: 'archive',
  // 视频
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', flv: 'video',
  wmv: 'video', m4v: 'video', mpeg: 'video', mpg: 'video',
  // 音频
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  wma: 'audio', opus: 'audio', aiff: 'audio',
})

/** mime 主类型 → 类型。 */
const MEDIA_TYPE_KINDS = Object.freeze({
  image: 'image',
  video: 'video',
  audio: 'audio',
})

const URL_PATTERN = /^https?:\/\/[^\s]+$/i
const SHA_PATTERN = /^sha256:([0-9a-f]{8,})/i

/** 取路径/名称的扩展名，小写、不含点；没有则返回 ''。 */
export function extensionOf(value) {
  if (typeof value !== 'string') return ''
  const withoutQuery = value.split(/[?#]/)[0]
  const leaf = withoutQuery.split(/[\\/]/).pop() ?? ''
  const dot = leaf.lastIndexOf('.')
  if (dot <= 0 || dot === leaf.length - 1) return ''
  return leaf.slice(dot + 1).toLowerCase()
}

/** 取路径/名称的末段（文件名）。 */
export function leafNameOf(value) {
  if (typeof value !== 'string') return ''
  const withoutQuery = value.split(/[?#]/)[0]
  return (withoutQuery.split(/[\\/]/).pop() ?? '').trim()
}

/** 是否 http(s) 链接。 */
export function isLink(value) {
  return typeof value === 'string' && URL_PATTERN.test(value.trim())
}

/**
 * 派生附件类型。优先用 mime，其次用扩展名，最后按链接判定。
 * 任何输入都返回一个 ATTACHMENT_KINDS 成员，绝不抛异常。
 */
export function kindOf({ name, mediaType, path } = {}) {
  const media = typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : ''
  const major = media.split('/')[0]
  if (MEDIA_TYPE_KINDS[major] !== undefined) return MEDIA_TYPE_KINDS[major]

  const target = typeof name === 'string' && name !== '' ? name : path
  if (isLink(target)) return ATTACHMENT_KINDS.LINK

  const extension = extensionOf(target)
  if (extension !== '' && EXTENSION_KINDS[extension] !== undefined) return EXTENSION_KINDS[extension]

  return ATTACHMENT_KINDS.UNKNOWN
}

/** 从 `sha256:<hex>` 形式的附件 ID 生成占位文件名。 */
function placeholderName(attachmentId) {
  const match = typeof attachmentId === 'string' ? SHA_PATTERN.exec(attachmentId) : null
  return match === null ? '附件' : `附件-${match[1].slice(0, 8)}`
}

/** 把任意值规范成 `number | null`，用于大小、序号等可选数值字段。 */
function optionalNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 把任意值规范成 `string | null`。 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 把一条 DSH 上传附件块规范成附件记录。
 * 容错：`attachment` 缺失、字段类型异常都不会抛异常，缺失字段落为 null。
 * @returns 附件记录；无法识别为附件时返回 null。
 */
export function normalizeBlockAttachment(block, context = {}) {
  const attachment = block?.attachment
  if (attachment === null || typeof attachment !== 'object') return null
  const sourceType = block.type === 'image' ? ATTACHMENT_SOURCES.IMAGE_BLOCK : ATTACHMENT_SOURCES.FILE_BLOCK

  const id = optionalString(attachment.attachmentId)
  const nameProvided = optionalString(attachment.name) !== null
  const name = nameProvided ? attachment.name : placeholderName(id)
  const bytes = optionalNumber(attachment.bytes)

  return {
    key: id ?? `block:${String(context.sessionId)}:${String(context.messageSeq)}:${String(context.ordinal)}`,
    id,
    kind: kindOf({ name: nameProvided ? attachment.name : '', mediaType: attachment.mediaType }),
    sourceType,
    name,
    nameProvided,
    mediaType: optionalString(attachment.mediaType),
    bytes,
    width: optionalNumber(attachment.width),
    height: optionalNumber(attachment.height),
    originalDimensions: attachment.originalDimensions ?? null,
    path: null,
    description: null,
    link: null,
    time: optionalNumber(context.time),
    timeSource: 'event',
    sessionId: optionalString(context.sessionId),
    messageSeq: optionalNumber(context.messageSeq),
    ordinal: optionalNumber(context.ordinal) ?? 0,
    raw: attachment,
  }
}

/**
 * 把一条交付物规范成附件记录。
 * 交付物没有 ID、类型、大小字段，全部按已确认的降级规则处理。
 */
export function normalizeDeliverable(file, context = {}) {
  const path = optionalString(file?.path)
  if (path === null) return null
  const name = leafNameOf(path) || path
  const link = isLink(path) ? path : null
  return {
    key: `deliverable:${path}`,
    id: optionalString(file.attachmentId),
    // A deliverable that *is* a URL is a link, not a file whose extension
    // merely looks recognisable: opening it needs a browser, not a viewer.
    kind: link === null ? kindOf({ name, path }) : ATTACHMENT_KINDS.LINK,
    sourceType: ATTACHMENT_SOURCES.DELIVERABLE,
    name,
    nameProvided: true,
    mediaType: null,
    bytes: optionalNumber(file.bytes),
    width: null,
    height: null,
    originalDimensions: null,
    path,
    description: optionalString(file.description),
    link,
    time: optionalNumber(context.time),
    timeSource: 'event',
    sessionId: optionalString(context.sessionId),
    messageSeq: optionalNumber(context.messageSeq),
    ordinal: optionalNumber(context.ordinal) ?? 0,
    raw: file,
  }
}

/**
 * 从一条消息的 content 数组提取全部附件。
 * 非数组、非对象、未知块类型都安全跳过。
 */
export function collectFromMessageContent(content, context = {}) {
  if (!Array.isArray(content)) return []
  const records = []
  let ordinal = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'image' && block.type !== 'file') continue
    const record = normalizeBlockAttachment(block, { ...context, ordinal })
    if (record !== null) records.push(record)
    ordinal += 1
  }
  return records
}

/** 从 `deliverables/presented` 事件提取全部交付物附件。 */
export function collectFromDeliverables(event, context = {}) {
  const files = event?.data?.files
  if (!Array.isArray(files)) return []
  const records = []
  let ordinal = 0
  for (const file of files) {
    const record = normalizeDeliverable(file, { ...context, ordinal })
    if (record !== null) records.push(record)
    ordinal += 1
  }
  return records
}

/**
 * 从任意会话事件提取附件。目前只认两类来源，其他事件返回空数组。
 * @param event - DSH 已提交事件 `{ type, seq, time, data }`
 */
export function collectFromEvent(event, context = {}) {
  if (event === null || typeof event !== 'object') return []
  const enriched = { sessionId: context.sessionId, messageSeq: event.seq, time: event.time }
  if (event.type === 'user/message') return collectFromMessageContent(event.data?.content, enriched)
  if (event.type === 'assistant/message') return collectFromMessageContent(event.data?.message?.content, enriched)
  if (event.type === 'deliverables/presented') return collectFromDeliverables(event, enriched)
  return []
}

/**
 * 建立「对话 → 附件」索引。
 * - 按 `key` 去重，`occurrences` 保留全部出现位置（消息ID 降级为事件 seq）
 * - 严格按 sessionId 分组，跨会话不串
 * @returns Map<sessionId, { sessionId, attachments, byKey, totalOccurrences }>
 */
export function indexByConversation(records) {
  const byConversation = new Map()
  if (!Array.isArray(records)) return byConversation

  for (const record of records) {
    if (record === null || typeof record !== 'object') continue
    const sessionId = record.sessionId ?? '未指定会话'
    let entry = byConversation.get(sessionId)
    if (entry === undefined) {
      entry = { sessionId, attachments: [], byKey: new Map(), totalOccurrences: 0 }
      byConversation.set(sessionId, entry)
    }

    entry.totalOccurrences += 1
    const existing = entry.byKey.get(record.key)
    if (existing === undefined) {
      const attachment = { ...record, occurrences: [{ messageSeq: record.messageSeq, time: record.time, ordinal: record.ordinal }] }
      entry.byKey.set(record.key, attachment)
      entry.attachments.push(attachment)
      continue
    }
    // 同一附件再次出现：只补出现位置，不重复计入卡片。
    if (!existing.occurrences.some((item) => item.messageSeq === record.messageSeq && item.ordinal === record.ordinal)) {
      existing.occurrences.push({ messageSeq: record.messageSeq, time: record.time, ordinal: record.ordinal })
    }
  }

  for (const entry of byConversation.values()) {
    entry.occurrencesById = new Map(entry.attachments.map((attachment) => [attachment.key, attachment.occurrences.length]))
  }
  return byConversation
}

/** 人类可读的字节数；未知大小返回空串，供卡片省略该段。 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * 把附件记录转成可直接渲染的展示对象。
 * 所有降级都收敛在这里：缺大小 → sizeLabel 为空串；未知类型 → 通用标签与图标键；
 * 缺文件名 → 已在识别阶段用占位名兜住。
 */
export function toDisplayAttachment(record) {
  if (record === null || typeof record !== 'object') return null
  const kind = typeof record.kind === 'string' && KIND_LABELS[record.kind] !== undefined ? record.kind : ATTACHMENT_KINDS.UNKNOWN
  const sizeLabel = formatBytes(record.bytes)
  const parts = [KIND_LABELS[kind], sizeLabel].filter((part) => part !== '')
  return {
    key: record.key,
    // The durable attachment id travels with the display object so a card can
    // be traced back to the stored object without re-deriving it.
    id: record.id ?? null,
    kind,
    kindLabel: KIND_LABELS[kind],
    iconKey: `attachment-${kind}`,
    name: typeof record.name === 'string' && record.name !== '' ? record.name : KIND_LABELS[kind],
    sizeLabel,
    metaLabel: parts.join(' · '),
    title: [record.name, KIND_LABELS[kind], sizeLabel, record.description].filter((part) => typeof part === 'string' && part !== '').join(' — '),
    path: record.path ?? null,
    link: record.link ?? null,
    sourceType: record.sourceType,
    messageSeq: record.messageSeq ?? null,
  }
}

/**
 * 找到某轮（`turn`）应当承载交付物的消息。
 *
 * `data.turn` 是**智能体循环轮次**而非提问序号：一个 turn 内可能有多条
 * user/message（例如 agent/inbox 注入），所以不能按提问顺序或 seq 就近推断。
 * 投影出的 assistant/error 消息带有同一个 `turn` 值，按它匹配是唯一可靠的对齐方式。
 * @returns 匹配的消息；没有则返回 null。
 */
export function findTurnHost(messages, turn) {
  if (!Array.isArray(messages) || !Number.isSafeInteger(turn)) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === null || typeof message !== 'object') continue
    if (message.kind !== 'assistant' && message.kind !== 'error') continue
    if (message.turn === turn) return message
  }
  return null
}

/** 汇总一批附件记录的类型分布，供卡片上的数量统计使用。 */
export function summarizeKinds(attachments) {
  const counts = Object.fromEntries(Object.values(ATTACHMENT_KINDS).map((kind) => [kind, 0]))
  if (!Array.isArray(attachments)) return counts
  for (const attachment of attachments) {
    const kind = attachment?.kind
    if (typeof kind === 'string' && counts[kind] !== undefined) counts[kind] += 1
  }
  return counts
}

/** 供卡片展示的短标签，如「图片 3 · 文档 2」。 */
export function kindSummaryLabel(attachments) {
  const counts = summarizeKinds(attachments)
  return Object.values(ATTACHMENT_KINDS)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${KIND_LABELS[kind]} ${counts[kind]}`)
    .join(' · ')
}
