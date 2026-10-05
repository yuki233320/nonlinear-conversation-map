import { open, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

export const PREVIEW_LIMITS = Object.freeze({ text: 512 * 1024, image: 8 * 1024 * 1024, pixels: 40_000_000 })
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.yaml', '.yml', '.xml', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.sql', '.toml', '.ini', '.conf', '.tex', '.html', '.htm', '.svg'])
function failure(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; return error }
function localAbsolute(value) {
  if (typeof value !== 'string' || value.includes('\0') || /^(?:[\\/]{2}|[a-z]+:\/\/|\\\\[?.]\\)/i.test(value)) return false
  if (process.platform === 'win32') return /^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')
  return path.isAbsolute(value)
}
function within(root, file) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
function recordedFilePath(cwd, value) {
  if (!localAbsolute(cwd) || typeof value !== 'string' || value.includes('\0')) throw failure('仅允许工作区内的本地文件路径', 403)
  let file
  if (localAbsolute(value)) file = path.resolve(value)
  else {
    // Relative deliverables are resolved only from their persisted owning cwd.
    // Colons reject drive-relative, URL and NTFS alternate stream syntax.
    if (/^[\\/]/.test(value) || value.includes(':')) throw failure('附件路径类型不允许预览', 403)
    file = path.resolve(cwd, value)
  }
  if (!within(path.resolve(cwd), file)) throw failure('附件路径超出工作区，无法预览', 403)
  return file
}
function raster(buffer, extension) {
  let width = 0, height = 0, mime = ''
  if (extension === '.png' && buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii',12,16) === 'IHDR') { width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20); mime = 'image/png' }
  if (extension === '.gif' && buffer.length >= 10 && /^GIF8[79]a$/.test(buffer.toString('ascii',0,6))) { width = buffer.readUInt16LE(6); height = buffer.readUInt16LE(8); mime = 'image/gif' }
  if (['.jpg','.jpeg'].includes(extension) && buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2
    while (offset + 4 < buffer.length) {
      if (buffer[offset++] !== 255) break
      while (buffer[offset] === 255) offset++
      const marker = buffer[offset++]; if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > buffer.length) break
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) { height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); mime = 'image/jpeg'; break }
      offset += length
    }
  }
  return mime && width > 0 && height > 0 && width * height <= PREVIEW_LIMITS.pixels ? mime : null
}

/** Only persisted attachment identities authorize reads; request paths are ignored. */
export async function readAttachmentPreview({ workspaces, identity }) {
  if (!identity || typeof identity.sessionId !== 'string' || !identity.sessionId || typeof identity.key !== 'string' || !identity.key || !Number.isSafeInteger(identity.seq) || identity.seq < 0) throw failure('附件标识无效')
  let found = null, workspace = null
  for (const item of Array.isArray(workspaces) ? workspaces : []) for (const thread of item.threads ?? []) {
    if (thread.dshSessionId !== identity.sessionId) continue
    for (const message of thread.messages ?? []) for (const list of [message.attachments, message.deliverables]) for (const attachment of Array.isArray(list) ? list : []) {
      if (attachment?.key !== identity.key || attachment.messageSeq !== identity.seq) continue
      if (found && found.path !== attachment.path) throw failure('附件记录不一致', 409)
      found = attachment; workspace = item
    }
  }
  if (!found) throw failure('附件已不可用，请重新选择', 404)
  const name = String(found.name ?? '附件').slice(0, 256)
  const unsupported = message => ({ kind: 'unsupported', name, message })
  if (!found.path) return unsupported('宿主没有提供此上传附件的文件内容访问能力。可在 DSH 原消息中查看。')
  const recordedPath = recordedFilePath(workspace.cwd, found.path)
  const extension = path.extname(recordedPath).toLowerCase()
  const image = ['.png','.jpg','.jpeg','.gif'].includes(extension)
  if (!image && !TEXT_EXTENSIONS.has(extension)) return unsupported('此文件类型暂不支持安全预览。请打开所在文件夹后使用适用的应用。')
  let handle
  try {
    const [root, file] = await Promise.all([realpath(workspace.cwd), realpath(recordedPath)])
    if (!within(root, file)) throw failure('附件真实路径超出工作区，无法预览', 403)
    // Read the canonical path and verify identity before/after the bounded read.
    const recordedStat = await stat(file)
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const before = await handle.stat()
    if (before.dev !== recordedStat.dev || before.ino !== recordedStat.ino) throw failure('文件在读取时发生变化，请重试', 409)
    if (!before.isFile()) throw failure('此附件不是普通文件', 403)
    const limit = image ? PREVIEW_LIMITS.image : PREVIEW_LIMITS.text
    if (before.size > limit) return unsupported(`文件超过预览大小上限（${image ? '8 MiB' : '512 KiB'}）。请在本地应用中打开。`)
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead }
    const after = await handle.stat()
    const [canonicalAfter, rootAfter, pathAfter] = await Promise.all([realpath(recordedPath), realpath(workspace.cwd), stat(file)])
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || canonicalAfter !== file || rootAfter !== root || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) throw failure('文件在读取时发生变化，请重试', 409)
    const content = buffer.subarray(0, length)
    if (image) { const mime = raster(content, extension); return mime ? { kind: 'image', name, mime, base64: content.toString('base64') } : unsupported('图片格式或尺寸不适合安全预览。请使用本地应用打开。') }
    if (content.includes(0)) return unsupported('此文件不是可识别的 UTF-8 文本。请使用本地应用打开。')
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content) } catch { return unsupported('文本编码暂不支持，预览支持 UTF-8。') }
    return { kind: 'text', name, text }
  } catch (error) {
    if (error.statusCode) throw error
    if (['ENOENT','ENOTDIR'].includes(error.code)) throw failure('文件已移动或不存在', 404)
    if (['EACCES','EPERM'].includes(error.code)) throw failure('没有读取此文件的权限', 403)
    throw failure('无法读取附件内容', 500)
  } finally { await handle?.close() }
}
