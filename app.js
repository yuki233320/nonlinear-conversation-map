;(function (global) {
  'use strict'
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character])
  const animations = new WeakMap()
  const reducedMotion = () => Boolean(global.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  function shell({ side = 'left', kind = 'attachment', title = '', body = '', footer = '', closeAction = 'close-attachment-preview', busy = false }) {
    side = side === 'right' ? 'right' : 'left'
    return `<aside class="map-panel map-panel-${side}" data-map-panel="${escape(kind)}" data-panel-side="${side}" aria-label="${escape(title)}" aria-busy="${Boolean(busy)}"><header class="map-panel-head"><strong>${escape(title)}</strong><button type="button" data-action="${escape(closeAction)}" aria-label="关闭${escape(title)}" title="关闭">×</button></header><div class="map-panel-body">${body}</div>${footer ? `<footer class="map-panel-footer">${footer}</footer>` : ''}</aside>`
  }
  function animate(element, { opening = true, particles = true } = {}) {
    animations.get(element)?.()
    let animation = null, timer = null, cleaned = false, sparks = []
    const cancel = () => { if (cleaned) return; cleaned = true; animation?.cancel(); if (timer !== null) global.clearTimeout(timer); sparks.forEach(spark => spark.remove()); sparks = []; if (animations.get(element) === cancel) animations.delete(element) }
    animations.set(element, cancel)
    element.style.pointerEvents = opening ? '' : 'none'
    if (reducedMotion() || typeof element.animate !== 'function') { cancel(); return cancel }
    const direction = element.dataset.panelSide === 'right' ? 1 : -1
    animation = element.animate(opening ? [ { transform:`translateX(${direction * 28}px)`, opacity:0 }, { transform:`translateX(${-direction * 3}px)`, opacity:1, offset:.78 }, { transform:'translateX(0)', opacity:1 } ] : [ { transform:'translateX(0)', opacity:1 }, { transform:`translateX(${direction * 20}px)`, opacity:0 } ], { duration:opening ? 290 : 160, easing:opening ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.4,0,1,1)' })
    animation.onfinish = () => {
      if (cleaned) return
      animation.cancel(); animation = null
      if (!opening || !particles || !element.isConnected) { cancel(); return }
      for (let index = 0; index < 6; index++) { const spark = element.ownerDocument.createElement('i'); spark.className = 'map-panel-spark'; spark.style.cssText = `--spark-y:${24 + index * 9}%;--spark-dx:${-direction * (8 + index % 3 * 5)}px;--spark-dy:${(index % 2 ? 1 : -1) * (4 + index * 2)}px`; element.appendChild(spark); sparks.push(spark) }
      timer = global.setTimeout(cancel, 800)
    }
    return cancel
  }
  async function defaultFetch(identity, signal) {
    const response = await global.fetch('/synapse/api/attachments/preview', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sessionId:identity.sessionId,key:identity.key,seq:identity.seq}), signal })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error ?? value.message ?? '无法预览附件')
    return value
  }
  function create({ onChange = () => {}, fetchPreview = defaultFetch, timeoutMs = 15000 } = {}) {
    let state = { open:false, status:'idle', identity:null, result:null, error:null }, revision = 0, request = null, timeout = null, disposed = false
    const snapshot = () => ({...state, identity:state.identity ? {...state.identity} : null, result:state.result ? {...state.result} : null})
    const emit = () => { if (!disposed) onChange(snapshot()) }
    const stop = () => { revision++; request?.abort(); request = null; if (timeout !== null) global.clearTimeout(timeout); timeout = null }
    async function openPreview(identity) {
      if (disposed) return
      stop(); const current = revision
      state = {open:true,status:'loading',identity:{...identity},result:null,error:null}; emit()
      const controller = new AbortController(); request = controller
      timeout = global.setTimeout(() => { if (current !== revision || disposed) return; controller.abort(); request = null; timeout = null; revision++; state = {...state,status:'error',error:'预览请求超时，请重试'}; emit() }, timeoutMs)
      try {
        const result = await fetchPreview({...identity}, controller.signal)
        if (disposed || current !== revision || controller.signal.aborted) return
        if (!result || !['text','image','unsupported'].includes(result.kind) || (result.kind === 'text' && (typeof result.text !== 'string' || result.text.length > 524288)) || (result.kind === 'image' && (!['image/png','image/jpeg','image/gif'].includes(result.mime) || typeof result.base64 !== 'string' || result.base64.length > 11184812 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64)))) throw new Error('附件预览响应无效')
        state = {...state,status:'ready',result:{...result}}; emit()
      } catch (error) { if (!disposed && current === revision && !controller.signal.aborted) { state = {...state,status:'error',error:error.message || '无法预览附件'}; emit() } }
      finally { if (current === revision) { request = null; if (timeout !== null) global.clearTimeout(timeout); timeout = null } }
    }
    function closePreview() { stop(); state = {...state,open:false,status:'idle',result:null,error:null}; emit() }
    function renderPreview(escapeHtml = escape) {
      if (!state.open) return ''
      const result = state.result
      let body = '<p class="map-panel-status" role="status">正在加载附件内容…</p>'
      if (state.status === 'error') body = `<p class="map-panel-status" role="alert">${escapeHtml(state.error)}</p>`
      if (state.status === 'ready') {
        if (result.kind === 'text') body = `<pre class="map-preview-text" tabindex="0">${escapeHtml(result.text)}</pre>`
        else if (result.kind === 'image') body = `<div class="map-preview-image"><img src="data:${result.mime};base64,${result.base64}" alt="${escapeHtml(result.name ?? state.identity?.name ?? '附件')}" decoding="async"></div>`
        else body = `<p class="map-panel-status">${escapeHtml(result.message ?? '此文件暂不支持预览，请使用本地应用打开。')}</p>`
      }
      const disabled = state.identity?.path ? '' : ' disabled'
      const footer = `<button type="button" data-action="attachment-reveal"${disabled}>打开所在文件夹</button><button type="button" data-action="attachment-copy-path"${disabled}>复制路径</button>${state.identity?.sessionId && Number.isInteger(state.identity?.seq) ? '<button type="button" data-action="attachment-locate">在 DSH 中查看原消息</button>' : ''}`
      return shell({side:'right',kind:'preview',title:result?.name ?? state.identity?.name ?? '附件内容预览',body,footer,closeAction:'close-right-preview',busy:state.status === 'loading'})
    }
    function dispose() { if (disposed) return; stop(); disposed = true; state = {open:false,status:'idle',identity:null,result:null,error:null} }
    return {openPreview,closePreview,snapshot,renderPreview,dispose}
  }
  global.SynapsePanels = Object.freeze({create,shell,animate,reducedMotion})
})(globalThis)

;
/* Local keyword search. The owner supplies accessible turn records and navigation. */
;(function (global) {
  'use strict'

  const GROUP_BATCH = 12
  const RESULT_BATCH = 20
  const SEARCH_CHUNK = 128
  const FREQUENCY_CAP = 4
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  const WORD = /[\p{L}\p{N}]/u
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
  let segmenter
  try { segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null } catch { segmenter = null }

  // Intl's word boundaries are preferred. Without it, each uninterrupted CJK
  // phrase is a keyword, never one keyword per character.
  function tokenize(value, options = {}) {
    const text = normalize(value)
    const engine = Object.prototype.hasOwnProperty.call(options, 'segmenter') ? options.segmenter : segmenter
    const tokens = []
    for (const part of text.split(' ')) {
      if (!part) continue
      if (engine && CJK.test(part)) {
        const words = [...engine.segment(part)].filter(segment => segment.isWordLike !== false && WORD.test(segment.segment)).map(segment => segment.segment)
        const grouped = []
        let singles = ''
        for (const word of words) {
          if (CJK.test(word) && [...word].length === 1) { singles += word; continue }
          if (singles) {
            // Some ICU builds return unknown Chinese words one character at a
            // time. Keep those contiguous characters together, including a
            // lone fragment beside a real CJK word, instead of noisy OR hits.
            if ([...singles].length === 1 && CJK.test(word)) { grouped.push(singles + word); singles = ''; continue }
            grouped.push(singles); singles = ''
          }
          grouped.push(word)
        }
        if (singles) {
          if ([...singles].length === 1 && CJK.test(grouped.at(-1) ?? '')) grouped[grouped.length - 1] += singles
          else grouped.push(singles)
        }
        tokens.push(...grouped)
      } else {
        const pieces = part.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)
        tokens.push(...(pieces ?? []))
      }
    }
    return [...new Set(tokens.filter(Boolean))]
  }

  function matchText(normalized, keywords, phrase) {
    const matched = []
    let frequency = 0
    for (const keyword of keywords) {
      let offset = 0
      let count = 0
      while (count < FREQUENCY_CAP) {
        const index = normalized.indexOf(keyword, offset)
        if (index < 0) break
        count++
        offset = index + keyword.length
      }
      if (count) { matched.push(keyword); frequency += count }
    }
    if (!matched.length) return null
    return { matched, coverage: matched.length, coverageRate: matched.length / keywords.length, phrase: phrase !== '' && normalized.includes(phrase) ? 1 : 0, frequency }
  }

  function compare(a, b) {
    return b.coverage - a.coverage || b.phrase - a.phrase || b.frequency - a.frequency || String(a.key).localeCompare(String(b.key))
  }

  const sessionKey = record => JSON.stringify([String(record.workspaceId ?? ''), String(record.sessionId ?? record.threadId ?? record.id ?? '')])
  function prepareRecords(records) {
    const entries = []
    const seen = new Set()
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || typeof record !== 'object') continue
      const key = String(record.id ?? record.cardId ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      entries.push({ key, record, sessionKey: sessionKey(record), normalized: normalize(record.text), attachments: (Array.isArray(record.attachments) ? record.attachments : []).filter(item => item && typeof item === 'object').map((attachment, index) => ({ attachment, index, name: String(attachment.name ?? attachment.fileName ?? '未命名附件'), normalized: normalize(attachment.name ?? attachment.fileName ?? '未命名附件') })) })
    }
    return entries
  }

  function rank(records, query, mode = 'text') {
    const keywords = tokenize(query)
    if (!keywords.length) return []
    const phrase = normalize(query)
    const entries = prepareRecords(records)
    return entries.flatMap(entry => scoreEntry(entry, keywords, phrase, mode)).sort(compare)
  }

  function scoreEntry(entry, keywords, phrase, mode) {
    if (mode !== 'attachment') {
      const score = matchText(entry.normalized, keywords, phrase)
      return score ? [{ ...score, key: entry.key, record: entry.record, sessionKey: entry.sessionKey }] : []
    }
    return entry.attachments.flatMap(item => {
      const score = matchText(item.normalized, keywords, phrase)
      return score ? [{ ...score, key: JSON.stringify([entry.key, item.attachment.messageSeq ?? '', item.attachment.key ?? item.index]), record: entry.record, attachment: item.attachment, name: item.name, sessionKey: entry.sessionKey }] : []
    })
  }

  function group(results, mode = 'text') {
    const groups = new Map()
    for (const result of results) {
      let entry = groups.get(result.sessionKey)
      if (!entry) {
        entry = { key: result.sessionKey, sessionId: result.record.sessionId, workspaceId: result.record.workspaceId, title: String(result.record.sessionTitle ?? '未命名会话'), results: [], compact: false }
        groups.set(result.sessionKey, entry)
      }
      entry.results.push(result)
    }
    for (const entry of groups.values()) {
      entry.results.sort(compare)
      entry.compact = mode === 'text' && entry.results.length > 5
    }
    return [...groups.values()].sort((a, b) => compare(a.results[0], b.results[0]) || a.key.localeCompare(b.key))
  }

  // Build source offsets so width/case/punctuation normalization can be
  // highlighted without ever treating conversation text as HTML.
  function normalizedOffsets(value) {
    const original = String(value ?? '')
    let text = ''
    const offsets = []
    let sourceIndex = 0
    let pendingSpace = null
    for (const sourceChar of original) {
      const end = sourceIndex + sourceChar.length
      for (const char of sourceChar.normalize('NFKC').toLocaleLowerCase()) {
        if (WORD.test(char)) {
          if (pendingSpace && text) { text += ' '; offsets.push(pendingSpace) }
          pendingSpace = null
          for (let index = 0; index < char.length; index++) offsets.push({ start: sourceIndex, end })
          text += char
        } else if (text) pendingSpace = { start: sourceIndex, end }
      }
      sourceIndex = end
    }
    return { text, offsets, original }
  }

  function highlight(value, keywords) {
    const { original, text, offsets } = normalizedOffsets(value)
    const ranges = []
    for (const rawKeyword of keywords ?? []) {
      const keyword = normalize(rawKeyword)
      if (!keyword) continue
      let index = text.indexOf(keyword)
      while (index >= 0) {
        const start = offsets[index]?.start
        const end = offsets[index + keyword.length - 1]?.end
        if (start !== undefined && end !== undefined) ranges.push({ start, end })
        index = text.indexOf(keyword, index + keyword.length)
      }
    }
    ranges.sort((a, b) => a.start - b.start || b.end - a.end)
    const merged = []
    for (const range of ranges) {
      const last = merged.at(-1)
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
      else merged.push({ ...range })
    }
    let result = ''
    let cursor = 0
    for (const range of merged) {
      result += escape(original.slice(cursor, range.start)) + '<mark>' + escape(original.slice(range.start, range.end)) + '</mark>'
      cursor = range.end
    }
    return result + escape(original.slice(cursor))
  }

  function excerpt(value, keywords, length = 190) {
    const raw = String(value ?? '').replace(/\s+/g, ' ').trim()
    if (raw.length <= length) return raw
    const mapped = normalizedOffsets(raw)
    const first = Math.min(...keywords.map(keyword => mapped.text.indexOf(keyword)).filter(index => index >= 0))
    const offset = Number.isFinite(first) ? mapped.offsets[first]?.start ?? 0 : 0
    const start = Math.max(0, offset - 45)
    return (start ? '…' : '') + raw.slice(start, start + length) + (start + length < raw.length ? '…' : '')
  }

  function placeFlyout(anchor, bounds, size = {}) {
    const padding = 8
    const width = Math.min(size.width ?? 420, Math.max(1, bounds.width - padding * 2))
    const height = Math.min(size.height ?? 450, Math.max(1, bounds.height - padding * 2))
    const minX = bounds.left + padding
    const maxX = bounds.left + bounds.width - padding - width
    const minY = bounds.top + padding
    const maxY = bounds.top + bounds.height - padding - height
    let left = anchor.right + 10
    if (left + width > bounds.left + bounds.width - padding) left = anchor.left - width - 10
    return { left: Math.max(minX, Math.min(left, Math.max(minX, maxX))), top: Math.max(minY, Math.min(anchor.top, Math.max(minY, maxY))), width, height }
  }

  function create(options = {}) {
    const later = options.setTimeout ?? global.setTimeout.bind(global)
    const clearLater = options.clearTimeout ?? global.clearTimeout.bind(global)
    const timers = new Set()
    const schedule = (fn, delay = 0) => { const id = later(() => { timers.delete(id); fn() }, delay); timers.add(id); return id }
    const cancelTimer = id => { if (id !== null && id !== undefined) { clearLater(id); timers.delete(id) } }
    let disposed = false
    let opened = false
    let query = ''
    let mode = options.mode === 'attachment' ? 'attachment' : 'text'
    let status = 'idle'
    let error = ''
    let entries = []
    let loaded = false
    let results = []
    let groups = []
    let total = 0
    let keywords = []
    let queryVersion = 0
    let loadVersion = 0
    let loadController = null
    let queryTimer = null
    let groupLimit = GROUP_BATCH
    const pages = new Map()
    const resultByToken = new Map()
    let root = null
    let document = null
    let view = null
    let unbind = []
    let composing = false
    let flyout = null
    let flyoutAnchor = null
    let flyoutResult = null
    let flyoutBindings = []
    let hoverTimer = null
    let leaveTimer = null
    let pointerStart = null
    let restoringFocus = false

    const listen = (target, name, fn, bucket, capture = false) => {
      target?.addEventListener?.(name, fn, capture)
      bucket.push(() => target?.removeEventListener?.(name, fn, capture))
    }
    const snapshot = () => ({ open: opened, query, mode, status, error, total, keywords: [...keywords], groupCount: groups.length, visibleGroupCount: Math.min(groups.length, groupLimit), groups, composing, hasFlyout: flyout !== null })
    const notify = reason => { if (!disposed) options.onChange?.(snapshot(), reason) }
    function resetPages() { groupLimit = GROUP_BATCH; pages.clear(); resultByToken.clear() }
    function cancelQuery() { queryVersion++; cancelTimer(queryTimer); queryTimer = null }
    function cancelLoad() { loadVersion++; loadController?.abort(); loadController = null }
    function clearHover() { cancelTimer(hoverTimer); cancelTimer(leaveTimer); hoverTimer = null; leaveTimer = null }

    function closeFlyout(restoreFocus = false) {
      clearHover()
      const anchor = flyoutAnchor
      flyoutAnchor?.setAttribute?.('aria-expanded', 'false')
      flyout?.remove?.()
      for (const remove of flyoutBindings.splice(0)) remove()
      flyout = null
      flyoutAnchor = null
      flyoutResult = null
      pointerStart = null
      if (restoreFocus && anchor?.isConnected !== false) {
        // focus() dispatches focusin synchronously; restoring keyboard focus
        // must not immediately reopen the dialog Escape just closed.
        restoringFocus = true
        try { anchor?.focus?.({ preventScroll: true }) } finally { restoringFocus = false }
      }
    }

    function runQuery(delay = 0) {
      cancelQuery()
      closeFlyout()
      resetPages()
      keywords = tokenize(query)
      results = []; groups = []; total = 0
      if (!opened) return
      if (!keywords.length) { status = loadController ? 'loading' : error ? 'error' : 'idle'; notify('results'); return }
      if (!loaded) { status = loadController ? 'loading' : error ? 'error' : 'idle'; notify('results'); return }
      const version = queryVersion
      const phrase = normalize(query)
      const activeMode = mode
      const matches = []
      let offset = 0
      status = 'searching'
      notify('query')
      function step() {
        queryTimer = null
        if (disposed || !opened || version !== queryVersion) return
        const end = Math.min(entries.length, offset + SEARCH_CHUNK)
        for (; offset < end; offset++) matches.push(...scoreEntry(entries[offset], keywords, phrase, activeMode))
        if (offset < entries.length) { queryTimer = schedule(step); return }
        results = matches.sort(compare)
        groups = group(results, activeMode)
        total = results.length
        status = 'ready'
        notify('results')
      }
      queryTimer = schedule(step, delay)
    }

    async function refresh(records) {
      if (disposed) return false
      cancelLoad(); cancelQuery(); closeFlyout()
      const version = loadVersion
      let controller = null
      if (records === undefined) {
        loaded = false
        controller = typeof AbortController === 'function' ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true } }
        loadController = controller
        if (opened) { status = 'loading'; error = ''; notify('data') }
      }
      try {
        const value = records === undefined ? await options.loadRecords?.(controller.signal) ?? [] : records
        if (disposed || version !== loadVersion || controller?.signal.aborted) return false
        entries = prepareRecords(value)
        loaded = true
        error = ''
        loadController = null
        runQuery()
        if (!opened) { results = []; groups = []; total = 0; status = 'idle' }
        return true
      } catch (failure) {
        if (disposed || version !== loadVersion || controller?.signal.aborted) return false
        loadController = null
        loaded = false
        status = 'error'
        error = String(failure?.message ?? '无法载入可访问会话')
        results = []; groups = []; total = 0
        notify('error')
        return false
      }
    }

    function setQuery(value, config = {}) {
      if (disposed) return
      const next = String(value ?? '')
      if (next === query && config.force !== true) return
      query = next
      runQuery(config.immediate ? 0 : 70)
    }
    function setMode(value) {
      if (disposed) return
      const next = value === 'attachment' ? 'attachment' : 'text'
      if (mode === next) return
      mode = next
      runQuery()
      notify('mode')
    }
    function focus() { root?.querySelector?.('[data-search-input]')?.focus?.({ preventScroll: true }) }
    function open() {
      if (disposed) return
      if (!opened) { opened = true; notify('open'); if (typeof options.loadRecords === 'function' || !loaded) void refresh(); else runQuery() }
      focus()
    }
    function close() {
      if (disposed) return
      opened = false
      composing = false
      cancelLoad(); cancelQuery(); closeFlyout()
      for (const remove of unbind.splice(0)) remove()
      root = null; document = null; view = null
      status = 'idle'
      notify('close')
    }

    function renderBar() {
      if (!opened) return ''
      const count = status === 'loading' ? '加载会话…' : status === 'searching' ? '检索中…' : `${total} 项结果`
      return `<div class="synapse-search-bar" data-synapse-search-bar data-map-control role="search" aria-label="地图搜索"><div class="synapse-search-modes" role="group" aria-label="搜索类型"><button type="button" data-search-action="mode-text" aria-pressed="${mode === 'text'}">文本</button><button type="button" data-search-action="mode-attachment" aria-pressed="${mode === 'attachment'}">附件</button></div><label class="synapse-search-input-wrap"><span class="synapse-search-icon" aria-hidden="true">⌕</span><input data-search-input type="search" value="${escape(query)}" autocomplete="off" spellcheck="false" placeholder="${mode === 'attachment' ? '搜索附件名称…' : '输入关键词，顺序不限…'}" aria-label="${mode === 'attachment' ? '搜索附件名称' : '搜索对话文本'}"></label><span class="synapse-search-scope">全部会话</span><span class="synapse-search-count" data-search-count role="status" aria-live="polite">${count}</span><button type="button" class="synapse-search-icon-button" data-search-action="clear" aria-label="清空搜索" title="清空搜索" ${query === '' ? 'disabled' : ''}>×</button><button type="button" class="synapse-search-icon-button" data-search-action="close" aria-label="关闭搜索" title="关闭搜索">✕</button></div>`
    }

    function resultToken(result) { const token = 'r' + resultByToken.size; resultByToken.set(token, result); return token }
    function recordMeta(record) {
      const turn = Number.isInteger(record.turnIndex) ? `第 ${record.turnIndex + 1} 轮` : Number.isInteger(record.sourceSeq) ? `消息 ${record.sourceSeq}` : '对话卡片'
      const session = String(record.sessionId ?? record.threadId ?? '')
      return `${turn}${session ? ' · ' + session.slice(-8) : ''}`
    }
    function tags(result) { return `<span class="synapse-search-keywords">${result.matched.map(word => `<span>${escape(word)}</span>`).join('')}<small>${result.coverage}/${keywords.length}</small></span>` }
    function renderResults() {
      resultByToken.clear()
      if (!opened) return ''
      if (status === 'error') return `<div class="synapse-search-empty" role="alert"><p>无法搜索会话：${escape(error)}</p><button type="button" data-search-action="reload">重新加载</button></div>`
      if (!keywords.length) return `<div class="synapse-search-empty"><p>${mode === 'attachment' ? '根据附件名称检索全部会话。' : '检索全部会话的实际对话文本。'}</p><p class="synapse-search-help">任意关键词命中即可入选，覆盖越完整越靠前。中文优先按词分段；不支持分词时按连续短语匹配。</p></div>`
      if (status === 'loading' || status === 'searching') return '<div class="synapse-search-empty" role="status">正在检索全部会话…</div>'
      if (!total) return '<div class="synapse-search-empty" role="status">没有匹配结果。可以减少关键词或切换搜索类型。</div>'
      const body = groups.slice(0, groupLimit).map((entry, groupIndex) => {
        const limit = entry.compact || mode === 'attachment' ? (pages.get(entry.key) ?? RESULT_BATCH) : 5
        const visible = entry.results.slice(0, limit)
        const rows = visible.map(result => {
          const token = resultToken(result)
          if (mode === 'attachment') return `<button type="button" class="synapse-search-result synapse-search-file" data-search-result="${token}" data-search-action="attachment"><span class="synapse-search-file-name">${highlight(result.name, result.matched)}</span><small>${escape(recordMeta(result.record))}${Number.isInteger(result.attachment.messageSeq) ? ' · 附件消息 ' + result.attachment.messageSeq : ''}</small></button>`
          if (entry.compact) return `<button type="button" class="synapse-search-result synapse-search-compact" data-search-result="${token}" data-search-action="expand" aria-haspopup="dialog" aria-expanded="false"><span class="synapse-search-compact-meta">${escape(recordMeta(result.record))}</span>${tags(result)}<span class="synapse-search-compact-title">${escape(String(result.record.question ?? excerpt(result.record.text, result.matched, 64)).slice(0, 90))}</span></button>`
          return `<button type="button" class="synapse-search-result synapse-search-summary" data-search-result="${token}" data-search-action="locate"><small>${escape(recordMeta(result.record))}</small><span class="synapse-search-excerpt">${highlight(excerpt(result.record.text, result.matched), result.matched)}</span>${tags(result)}</button>`
        }).join('')
        const more = entry.results.length > visible.length ? `<button type="button" class="synapse-search-more" data-search-action="more" data-search-group="${groupIndex}">再显示 ${Math.min(RESULT_BATCH, entry.results.length - visible.length)} 项 · 尚有 ${entry.results.length - visible.length} 项</button>` : ''
        return `<section class="synapse-search-group${entry.compact ? ' is-compact' : ''}" aria-label="${escape(entry.title)}"><header><h3 title="${escape(entry.title)}">${escape(entry.title)}</h3><span>${entry.results.length}</span></header><div class="synapse-search-group-results">${rows}</div>${more}</section>`
      }).join('')
      const remaining = groups.length - groupLimit
      return `<div class="synapse-search-results" data-synapse-search-results><div class="synapse-search-results-summary">${total} 项 · ${groups.length} 个会话 · 全部会话</div>${body}${remaining > 0 ? `<button type="button" class="synapse-search-more synapse-search-more-groups" data-search-action="more-groups">继续显示会话 · 尚有 ${remaining} 组</button>` : ''}</div>`
    }

    function boundsForFlyout() {
      const viewport = view?.visualViewport
      const fallback = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? document?.documentElement?.clientWidth ?? 1024, height: viewport?.height ?? document?.documentElement?.clientHeight ?? 768 }
      const supplied = options.getFlyoutBounds?.()
      if (supplied && [supplied.left, supplied.top, supplied.width, supplied.height].every(Number.isFinite) && supplied.width >= 140 && supplied.height >= 120) return supplied
      let left = fallback.left
      let right = fallback.left + fallback.width
      let top = fallback.top
      for (const panel of root?.querySelectorAll?.('[data-map-panel][data-panel-side]') ?? []) {
        const rect = panel.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        if (panel.getAttribute('data-panel-side') === 'left') left = Math.max(left, rect.right)
        else right = Math.min(right, rect.left)
      }
      const barRect = root?.querySelector?.('[data-synapse-search-bar]')?.getBoundingClientRect?.()
      if (barRect) top = Math.max(top, barRect.bottom)
      return right - left >= 140 && fallback.top + fallback.height - top >= 120 ? { left, top, width: right - left, height: fallback.top + fallback.height - top } : fallback
    }
    function positionFlyout() {
      if (!flyout || !flyoutAnchor || flyoutAnchor.isConnected === false) { closeFlyout(); return }
      const bounds = boundsForFlyout()
      const position = placeFlyout(flyoutAnchor.getBoundingClientRect(), bounds)
      Object.assign(flyout.style, { left: position.left + 'px', top: position.top + 'px', width: position.width + 'px', maxHeight: position.height + 'px' })
    }

    function locate(result) {
      if (!result || disposed) return
      closeFlyout()
      options.onLocate?.(result.record)
    }
    function showFlyout(anchor, result, focusContent = false) {
      if (disposed || !opened || !document?.createElement || !result) return
      clearHover()
      if (flyout && flyoutResult?.key === result.key) {
        if (flyoutAnchor !== anchor) { flyoutAnchor?.setAttribute?.('aria-expanded', 'false'); flyoutAnchor = anchor; anchor.setAttribute?.('aria-expanded', 'true') }
        positionFlyout()
        if (focusContent) flyout.querySelector?.('[data-search-flyout-locate]')?.focus?.({ preventScroll: true })
        return
      }
      closeFlyout()
      flyoutAnchor = anchor
      flyoutResult = result
      const element = document.createElement('section')
      flyout = element
      element.className = 'synapse-search-flyout'
      element.setAttribute('data-map-control', '')
      element.setAttribute('data-search-flyout', '')
      element.setAttribute('role', 'dialog')
      element.setAttribute('aria-modal', 'false')
      element.setAttribute('aria-label', '搜索命中卡片：' + String(result.record.sessionTitle ?? '会话'))
      const attachmentRows = (Array.isArray(result.record.attachments) ? result.record.attachments : []).map((attachment, index) => attachment && typeof attachment === 'object' ? `<button type="button" data-search-flyout-attachment="${index}" class="synapse-search-flyout-attachment">${escape(attachment.name ?? attachment.fileName ?? '附件')}</button>` : '').join('')
      element.innerHTML = `<header class="synapse-search-flyout-head thread-card-head"><div><span class="synapse-search-flyout-session">${escape(result.record.sessionTitle ?? '未命名会话')}</span><strong>${escape(result.record.question ?? '对话卡片')}</strong><small class="thread-meta">${escape(recordMeta(result.record))}</small></div><button type="button" data-search-flyout-close aria-label="关闭展开卡片" title="关闭">×</button></header><div class="synapse-search-flyout-scroll"><div class="synapse-search-flyout-text thread-answer" tabindex="0" role="button" aria-label="定位这张对话卡片">${highlight(result.record.text, result.matched)}</div>${attachmentRows ? `<div class="synapse-search-flyout-attachments">${attachmentRows}</div>` : ''}</div><footer>${tags(result)}<button type="button" data-search-flyout-locate>定位卡片</button></footer>`
      anchor.setAttribute?.('aria-expanded', 'true')
      ;(document.body ?? root).appendChild(element)
      positionFlyout()
      const keep = () => { cancelTimer(leaveTimer); leaveTimer = null }
      listen(element, 'pointerover', keep, flyoutBindings)
      listen(element, 'pointerout', event => { if (!element.contains(event.relatedTarget) && !anchor.contains?.(event.relatedTarget)) scheduleLeave() }, flyoutBindings)
      listen(element, 'focusin', keep, flyoutBindings)
      listen(element, 'focusout', event => { if (!element.contains(event.relatedTarget) && !anchor.contains?.(event.relatedTarget)) scheduleLeave() }, flyoutBindings)
      listen(element, 'pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; event.stopPropagation() }, flyoutBindings)
      listen(element, 'click', event => {
        event.stopPropagation()
        if (event.target.closest?.('[data-search-flyout-close]')) { closeFlyout(true); return }
        const file = event.target.closest?.('[data-search-flyout-attachment]')
        if (file) { const attachment = result.record.attachments[Number(file.getAttribute('data-search-flyout-attachment'))]; closeFlyout(); options.onAttachment?.(result.record, attachment); return }
        const onText = event.target.closest?.('.synapse-search-flyout-text')
        const moved = pointerStart && Math.hypot((event.clientX ?? pointerStart.x) - pointerStart.x, (event.clientY ?? pointerStart.y) - pointerStart.y) > 6
        if (event.target.closest?.('[data-search-flyout-locate]') || (onText && !moved && !String(view?.getSelection?.() ?? ''))) locate(result)
      }, flyoutBindings)
      listen(element, 'keydown', event => {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFlyout(true) }
        else if (event.key === 'Enter' && event.target.closest?.('.synapse-search-flyout-text')) { event.preventDefault(); event.stopPropagation(); locate(result) }
      }, flyoutBindings)
      listen(document, 'pointerdown', event => { if (!element.contains(event.target) && !anchor.contains?.(event.target)) closeFlyout() }, flyoutBindings, true)
      listen(view, 'resize', positionFlyout, flyoutBindings)
      listen(document, 'scroll', event => { if (!element.contains(event.target)) positionFlyout() }, flyoutBindings, true)
      if (focusContent) element.querySelector?.('[data-search-flyout-locate]')?.focus?.({ preventScroll: true })
    }
    function scheduleLeave() { cancelTimer(leaveTimer); leaveTimer = schedule(() => { leaveTimer = null; closeFlyout() }, 180) }
    function targetResult(event) {
      const target = event.target?.closest?.('[data-search-result]')
      if (!target || !root?.contains?.(target)) return null
      return { target, result: resultByToken.get(target.getAttribute('data-search-result')) }
    }
    function searchElement(target) { return target?.closest?.('[data-synapse-search-bar], [data-synapse-search-results], .synapse-search-empty') }

    function mount(element) {
      if (disposed || !element) return
      if (!opened) return
      if (root === element) { if (flyoutAnchor?.isConnected === false) closeFlyout(); return }
      closeFlyout()
      for (const remove of unbind.splice(0)) remove()
      root = element
      document = root.ownerDocument ?? global.document
      view = document?.defaultView ?? global
      listen(root, 'compositionstart', event => { if (event.target?.matches?.('[data-search-input]')) composing = true }, unbind)
      listen(root, 'compositionend', event => { if (event.target?.matches?.('[data-search-input]')) { composing = false; setQuery(event.target.value) } }, unbind)
      listen(root, 'input', event => {
        if (!event.target?.matches?.('[data-search-input]')) return
        event.stopPropagation()
        if (!composing && !event.isComposing) setQuery(event.target.value)
      }, unbind)
      listen(root, 'click', event => {
        const button = event.target?.closest?.('[data-search-action]')
        if (!button || !root.contains(button)) return
        event.stopPropagation()
        const action = button.getAttribute('data-search-action')
        const result = resultByToken.get(button.getAttribute('data-search-result'))
        if (action === 'close') close()
        else if (action === 'clear') { setQuery('', { immediate: true }); focus() }
        else if (action === 'mode-text') { setMode('text'); focus() }
        else if (action === 'mode-attachment') { setMode('attachment'); focus() }
        else if (action === 'reload') void refresh()
        else if (action === 'locate') locate(result)
        else if (action === 'attachment' && result) { closeFlyout(); options.onAttachment?.(result.record, result.attachment) }
        else if (action === 'expand' && result) showFlyout(button, result, true)
        else if (action === 'more') {
          const entry = groups[Number(button.getAttribute('data-search-group'))]
          if (entry) { pages.set(entry.key, (pages.get(entry.key) ?? RESULT_BATCH) + RESULT_BATCH); closeFlyout(); notify('page') }
        } else if (action === 'more-groups') { groupLimit += GROUP_BATCH; closeFlyout(); notify('page') }
      }, unbind)
      listen(root, 'pointerover', event => {
        const match = targetResult(event)
        if (!match || match.target.getAttribute('data-search-action') !== 'expand' || event.pointerType === 'touch' || match.target.contains?.(event.relatedTarget)) return
        clearHover()
        hoverTimer = schedule(() => { hoverTimer = null; if (match.target.isConnected !== false) showFlyout(match.target, match.result) }, 120)
      }, unbind)
      listen(root, 'pointerout', event => {
        const match = targetResult(event)
        if (!match || match.target.contains?.(event.relatedTarget)) return
        cancelTimer(hoverTimer); hoverTimer = null
        if (flyout?.contains?.(event.relatedTarget)) return
        if (flyoutAnchor === match.target) scheduleLeave()
      }, unbind)
      listen(root, 'focusin', event => {
        if (restoringFocus) return
        const match = targetResult(event)
        if (match?.target.getAttribute('data-search-action') === 'expand') showFlyout(match.target, match.result)
      }, unbind)
      listen(root, 'focusout', event => {
        const match = targetResult(event)
        if (match && !match.target.contains?.(event.relatedTarget) && !flyout?.contains?.(event.relatedTarget)) scheduleLeave()
      }, unbind)
      listen(root, 'keydown', event => {
        if (event.isComposing || composing || event.keyCode === 229) return
        const match = targetResult(event)
        if (match?.target.getAttribute('data-search-action') === 'expand' && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); locate(match.result) }
        else if (flyout && event.key === 'Escape' && searchElement(event.target)) { event.preventDefault(); event.stopPropagation(); closeFlyout(true) }
      }, unbind)
    }

    function dispose() {
      if (disposed) return
      close()
      disposed = true
      for (const remove of unbind.splice(0)) remove()
      for (const timer of [...timers]) cancelTimer(timer)
      root = null; document = null; view = null; entries = []; results = []; groups = []
      resultByToken.clear(); pages.clear()
    }
    return { open, close, setQuery, setMode, refresh, snapshot, renderBar, renderResults, mount, focus, closeFlyout, hasFlyout: () => flyout !== null, getResult: token => resultByToken.get(token), dispose }
  }

  global.SynapseSearch = Object.freeze({ create, tokenize, normalize, rank, group, highlight, excerpt, placeFlyout, compare, prepareRecords, constants: Object.freeze({ GROUP_BATCH, RESULT_BATCH, SEARCH_CHUNK, FREQUENCY_CAP }) })
})(globalThis)

;
(function (global) {
  'use strict'

  const SEQUENCE_TIMING = Object.freeze({ duration: 1500, stagger: 650, maxActive: 3 })
  const RGB_CLASS = 'synapse-session-rgb'
  const STATIC_CLASS = 'synapse-session-static'
  const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key)
  const number = (value, fallback, minimum = 0) => value != null && value !== '' && Number.isFinite(Number(value)) ? Math.max(minimum, Number(value)) : fallback
  const compareId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  const ordinal = value => Number.isFinite(Number(value)) && value != null ? Number(value) : Number.MAX_SAFE_INTEGER
  const compareTurn = (a, b) => ordinal(a.turnIndex) - ordinal(b.turnIndex) || ordinal(a.sourceSeq) - ordinal(b.sourceSeq) || compareId(a.id, b.id)

  function dimensions(card, options) {
    const provided = typeof options.cardSizes === 'function' ? options.cardSizes(card)
      : options.cardSizes?.get?.(card.id) ?? options.cardSizes?.[card.id]
    return {
      width: number(provided?.width, number(options.cardWidth, 310, 1), 1),
      height: number(provided?.height, number(options.cardHeight, 276, 1), 1),
    }
  }

  // Select using the projection tree; a fork's inherited ancestors never enter
  // its dedicated canvas. Native IDs can select several matching projections.
  function selectedThreads(threads, target) {
    const byId = new Map(threads.filter(thread => thread?.id != null).map(thread => [thread.id, thread]))
    const threadId = typeof target === 'object' && target !== null ? target.threadId : target
    const sessionId = typeof target === 'object' && target !== null ? target.sessionId : target
    let roots = byId.has(threadId) ? [byId.get(threadId)] : threads.filter(thread => sessionId != null && thread?.dshSessionId === sessionId)
    roots = roots.slice().sort((a, b) => compareId(a.id, b.id))
    const children = new Map()
    for (const thread of byId.values()) {
      if (thread.parentId == null || !byId.has(thread.parentId)) continue
      const group = children.get(thread.parentId) ?? []
      group.push(thread)
      children.set(thread.parentId, group)
    }
    for (const group of children.values()) group.sort((a, b) => ordinal(a.sourceSeedLength) - ordinal(b.sourceSeedLength) || compareId(a.id, b.id))
    const ids = new Set()
    const stack = roots.slice().reverse()
    while (stack.length) {
      const thread = stack.pop()
      if (ids.has(thread.id)) continue
      ids.add(thread.id)
      const group = children.get(thread.id) ?? []
      for (let i = group.length - 1; i >= 0; i--) stack.push(group[i])
    }
    return { ids, roots: new Set(roots.map(thread => thread.id)), byId }
  }

  function layout(inputCards, inputThreads, target, options = {}) {
    const threads = Array.isArray(inputThreads) ? inputThreads : []
    const selection = selectedThreads(threads, target)
    const byId = new Map()
    for (const card of Array.isArray(inputCards) ? inputCards : []) {
      if (card?.id == null || !selection.ids.has(card.dshThreadId) || byId.has(card.id)) continue
      byId.set(card.id, card)
    }
    const children = new Map()
    for (const card of byId.values()) {
      if (card.parentId == null || !byId.has(card.parentId)) continue
      const group = children.get(card.parentId) ?? []
      group.push(card)
      children.set(card.parentId, group)
    }
    for (const [parentId, group] of children) {
      const parent = byId.get(parentId)
      group.sort((a, b) => {
        const aContinuation = a.dshThreadId === parent.dshThreadId
        const bContinuation = b.dshThreadId === parent.dshThreadId
        return Number(bContinuation) - Number(aContinuation)
          || ordinal(selection.byId.get(a.dshThreadId)?.sourceSeedLength) - ordinal(selection.byId.get(b.dshThreadId)?.sourceSeedLength)
          || compareId(a.dshThreadId, b.dshThreadId) || compareTurn(a, b)
      })
    }
    const ordered = []
    const seen = new Set()
    const walk = root => {
      const stack = [root]
      while (stack.length) {
        const card = stack.pop()
        if (seen.has(card.id)) continue
        seen.add(card.id)
        ordered.push(card)
        const group = children.get(card.id) ?? []
        for (let i = group.length - 1; i >= 0; i--) stack.push(group[i])
      }
    }
    const sorted = [...byId.values()].sort((a, b) => Number(selection.roots.has(b.dshThreadId)) - Number(selection.roots.has(a.dshThreadId))
      || compareId(a.dshThreadId, b.dshThreadId) || compareTurn(a, b))
    for (const card of sorted) if (card.parentId == null || !byId.has(card.parentId)) walk(card)
    // Broken or cyclic imports remain viewable, once each, without inventing edges.
    for (const card of sorted) walk(card)

    const sizes = ordered.map(card => dimensions(card, options))
    const cellWidth = sizes.length ? sizes.reduce((maximum, size) => Math.max(maximum, size.width), 0) : number(options.cardWidth, 310, 1)
    const gapX = number(options.gapX, 55, 24)
    const gapY = number(options.gapY, 64, 24)
    const insetX = number(options.insetX, 86)
    const insetY = number(options.insetY, 82)
    const width = number(options.width, 1100, 1)
    const columns = Math.max(1, Math.min(Math.max(1, ordered.length), Math.floor((Math.max(0, width - 2 * insetX) + gapX) / (cellWidth + gapX))))
    const rowHeights = []
    for (let i = 0; i < ordered.length; i++) {
      const row = Math.floor(i / columns)
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, sizes[i].height)
    }
    const rowTops = []
    let y = insetY
    for (const height of rowHeights) { rowTops.push(y); y += height + gapY }
    const gridRight = insetX + columns * cellWidth + (columns - 1) * gapX
    const cards = ordered.map((source, index) => {
      const row = Math.floor(index / columns)
      const inRow = index % columns
      const column = row % 2 ? columns - 1 - inRow : inRow
      const position = { x: insetX + column * (cellWidth + gapX), y: rowTops[row] }
      const parent = byId.get(source.parentId)
      return {
        ...source,
        position,
        naturalPosition: { ...position },
        positionLocked: false,
        sessionLayout: {
          index, row, column, ...sizes[index], rowTop: rowTops[row], rowBottom: rowTops[row] + rowHeights[row],
          gridLeft: insetX, gridRight, gapY, lane: index % 4,
          initialX: position.x, initialY: position.y,
          isBranch: parent != null && parent.dshThreadId !== source.dshThreadId,
        },
      }
    })
    const resultById = new Map(cards.map(card => [card.id, card]))
    const edges = cards.flatMap(card => {
      const parent = resultById.get(card.parentId)
      return parent == null ? [] : [{ fromId: parent.id, toId: card.id, isBranch: card.sessionLayout.isBranch, path: connectorPath(parent, card) }]
    })
    const bounds = cards.length === 0 ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: insetX - 48, y: insetY - gapY * .66, width: gridRight - insetX + 96, height: y - gapY - insetY + gapY * 1.32 }
    return {
      cards, orderedIds: cards.map(card => card.id), edges, columns, bounds,
      selectedThreadIds: [...selection.ids], size: { width: cellWidth, height: number(options.cardHeight, 276, 1) },
    }
  }

  function connectorPath(fromCard, toCard, size = {}) {
    if (!fromCard?.position || !toCard?.position) return ''
    const from = fromCard.sessionLayout
    const to = toCard.sessionLayout
    const fw = number(from?.width, number(size.width ?? size.cardWidth, 310, 1), 1)
    const fh = number(from?.height, number(size.height ?? size.cardHeight, 276, 1), 1)
    const tw = number(to?.width, number(size.width ?? size.cardWidth, 310, 1), 1)
    const th = number(to?.height, number(size.height ?? size.cardHeight, 276, 1), 1)
    const fx = Number(fromCard.position.x), fy = Number(fromCard.position.y)
    const tx = Number(toCard.position.x), ty = Number(toCard.position.y)
    if (![fx, fy, tx, ty].every(Number.isFinite)) return ''
    const path = points => points.map((point, index) => `${index ? 'L' : 'M'} ${Math.round(point[0] * 100) / 100} ${Math.round(point[1] * 100) / 100}`).join(' ')
    const stable = from && to && fx === from.initialX && fy === from.initialY && tx === to.initialX && ty === to.initialY
    if (!stable) {
      const movingRight = tx >= fx + fw
      const a = [movingRight ? fx + fw : fx, fy + fh / 2]
      const b = [movingRight ? tx : tx + tw, ty + th / 2]
      const elbow = (a[0] + b[0]) / 2
      return path([a, [elbow, a[1]], [elbow, b[1]], b])
    }
    if (from.row === to.row && Math.abs(from.column - to.column) === 1) {
      const movingRight = from.column < to.column
      const a = [movingRight ? fx + fw : fx, fy + fh / 2]
      const b = [movingRight ? tx : tx + tw, ty + th / 2]
      const elbow = (a[0] + b[0]) / 2
      return path([a, [elbow, a[1]], [elbow, b[1]], b])
    }
    const lane = to.lane
    const offset = to.gapY * (.3 + lane * .12)
    if (from.row === to.row) {
      const gutter = Math.min(from.rowTop, to.rowTop) - offset
      return path([[fx + fw / 2, fy], [fx + fw / 2, gutter], [tx + tw / 2, gutter], [tx + tw / 2, ty]])
    }
    const movingDown = from.row < to.row
    const a = [fx + fw / 2, movingDown ? fy + fh : fy]
    const b = [tx + tw / 2, movingDown ? ty : ty + th]
    const sourceGutter = movingDown ? from.rowBottom + offset : from.rowTop - offset
    const targetGutter = movingDown ? to.rowTop - offset : to.rowBottom + offset
    if (Math.abs(from.row - to.row) === 1 && from.column === to.column) {
      const gutter = movingDown ? (from.rowBottom + to.rowTop) / 2 : (to.rowBottom + from.rowTop) / 2
      return path([a, [a[0], gutter], [b[0], gutter], b])
    }
    // Long branch edges travel along the outer gutters, never through a row.
    const useLeft = tx + tw / 2 <= (to.gridLeft + to.gridRight) / 2
    const outerX = useLeft ? to.gridLeft - 20 - lane * 8 : to.gridRight + 20 + lane * 8
    return path([a, [a[0], sourceGutter], [outerX, sourceGutter], [outerX, targetGutter], [b[0], targetGutter], b])
  }

  function createSequence(options = {}) {
    const getElement = options.getElement ?? (() => null)
    const now = options.now ?? (() => global.performance?.now?.() ?? Date.now())
    const schedule = options.setTimeout ?? global.setTimeout.bind(global)
    const unschedule = options.clearTimeout ?? global.clearTimeout.bind(global)
    const reducedMotion = typeof options.reducedMotion === 'function' ? options.reducedMotion
      : own(options, 'reducedMotion') ? () => Boolean(options.reducedMotion)
        : () => Boolean(global.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    const effects = new Map()
    let ids = [], startedAt = 0, lastTime = 0, timer = null, epoch = 0, timerRevision = 0
    let started = false, complete = false, reduced = false, disposed = false, activeIds = []

    function clean(element) {
      element?.classList?.remove(RGB_CLASS, STATIC_CLASS)
      element?.style?.removeProperty('--synapse-rgb-duration')
      element?.style?.removeProperty('--synapse-rgb-delay')
    }
    function clearTimer() {
      timerRevision++
      if (timer !== null) unschedule(timer)
      timer = null
    }
    function cancel() {
      epoch++
      clearTimer()
      for (const effect of effects.values()) clean(effect.element)
      effects.clear()
      ids = []
      activeIds = []
      started = false
      complete = false
    }
    function sync() {
      if (disposed || !started || complete) return
      clearTimer()
      const current = Number(now())
      lastTime = Math.max(lastTime, Number.isFinite(current) ? current : lastTime)
      const elapsed = Math.max(0, lastTime - startedAt)
      const length = reduced ? Math.min(1, ids.length) : ids.length
      const total = length ? (length - 1) * SEQUENCE_TIMING.stagger + SEQUENCE_TIMING.duration : 0
      if (elapsed >= total) {
        for (const effect of effects.values()) clean(effect.element)
        effects.clear()
        activeIds = []
        complete = true
        return
      }
      const first = reduced ? 0 : Math.max(0, Math.floor((elapsed - SEQUENCE_TIMING.duration) / SEQUENCE_TIMING.stagger) + 1)
      const last = reduced ? 0 : Math.min(length - 1, Math.floor(elapsed / SEQUENCE_TIMING.stagger))
      const desired = new Map()
      activeIds = []
      for (let index = first; index <= last; index++) {
        const id = ids[index]
        activeIds.push(id)
        let element = null
        try { element = getElement(id) } catch (_) { /* An unmounted card is simply skipped. */ }
        if (element?.classList?.add) desired.set(id, { element, elapsed: elapsed - index * SEQUENCE_TIMING.stagger })
      }
      for (const [id, effect] of effects) {
        if (desired.get(id)?.element === effect.element) continue
        clean(effect.element)
        effects.delete(id)
      }
      for (const [id, wanted] of desired) {
        if (effects.get(id)?.element === wanted.element) continue
        wanted.element.style?.setProperty('--synapse-rgb-duration', `${SEQUENCE_TIMING.duration}ms`)
        wanted.element.style?.setProperty('--synapse-rgb-delay', `${-wanted.elapsed}ms`)
        wanted.element.classList.add(reduced ? STATIC_CLASS : RGB_CLASS)
        effects.set(id, { element: wanted.element })
      }
      const nextStart = reduced || last + 1 >= length ? Infinity : (last + 1) * SEQUENCE_TIMING.stagger
      const nextEnd = reduced ? SEQUENCE_TIMING.duration : first * SEQUENCE_TIMING.stagger + SEQUENCE_TIMING.duration
      const delay = Math.max(1, Math.min(nextStart, nextEnd, total) - elapsed)
      const token = epoch
      const revision = timerRevision
      timer = schedule(() => {
        if (disposed || token !== epoch || revision !== timerRevision) return
        timer = null
        sync()
      }, delay)
    }
    function start(orderedIds) {
      if (disposed) return false
      const nextIds = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).filter(id => id != null).map(String))]
      if (started && ids.length === nextIds.length && ids.every((id, index) => id === nextIds[index])) return false
      cancel()
      ids = nextIds
      reduced = Boolean(reducedMotion())
      const current = Number(now())
      startedAt = lastTime = Number.isFinite(current) ? current : 0
      started = true
      complete = ids.length === 0
      sync()
      return true
    }
    function dispose() {
      if (disposed) return
      cancel()
      disposed = true
    }
    function snapshot() {
      return { started, complete, reduced, disposed, totalIds: ids.length, activeIds: [...activeIds], activeEffects: effects.size, scheduledTimers: timer === null ? 0 : 1 }
    }
    return { start, sync, cancel, dispose, snapshot }
  }

  global.SynapseSessionCanvas = Object.freeze({ layout, connectorPath, createSequence, SEQUENCE_TIMING })
})(globalThis)

;
const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
const LEGACY_CARD_POSITIONS_KEY = 'dsh-synapse:card-positions'
const CARD_POSITIONS_KEY = 'dsh-synapse:card-positions:v3'
const COLLAPSED_CARDS_KEY = 'dsh-synapse:collapsed-cards:v1'
const QUICK_PHRASES_KEY = 'dsh-synapse:quick-phrases:v1'
const DEFAULT_QUICK_PHRASES = ['展开说明', '举例', '通俗易懂', '对比解释']
const MAX_QUICK_PHRASES = 12
const MAX_QUICK_PHRASE_LENGTH = 16
function normalizeQuickPhrases(value) {
  if (!Array.isArray(value)) return []
  const phrases = []
  for (const item of value) {
    const phrase = typeof item === 'string' ? item.trim().slice(0, MAX_QUICK_PHRASE_LENGTH) : ''
    if (phrase !== '' && !phrases.includes(phrase)) phrases.push(phrase)
    if (phrases.length === MAX_QUICK_PHRASES) break
  }
  return phrases
}
const savedQuickPhrases = (() => {
  try {
    const stored = localStorage.getItem(QUICK_PHRASES_KEY)
    return stored === null ? DEFAULT_QUICK_PHRASES : normalizeQuickPhrases(JSON.parse(stored))
  } catch { return DEFAULT_QUICK_PHRASES }
})()
const savedBranchAnchors = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:branch-anchors') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedCardPositions = (() => {
  try {
    // Drop formats that were never persisted; the current key stores drags.
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    const value = JSON.parse(localStorage.getItem(CARD_POSITIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)) : []
  } catch { return [] }
})()
const savedCollapsedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
const CARD_WIDTH = 310
const CARD_HEIGHT = 276
const CARD_GAP_Y = 42
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
// Cards outside the viewport (plus this world-space margin) are not mounted
// into the DOM; the margin pre-mounts cards just before they scroll into view
// so panning never flashes empty space.
const VIEWPORT_MARGIN = 1400
const state = {
  browserMode: 'global', sessionTarget: null, globalView: null, sessionViews: new Map(), sessionPositions: new Map(), allProjections: [], leftPanel: null, selectedAttachment: null, awaitingInitialCurrent: true,
  summaries: [], workspace: null, activeId: null, selectedCardId: null, mode: 'canvas', zoom: 1, currentDsh: null, sidebarCollapsed: false,
  dshWorkspaces: [], selectedDshWorkspaceId: null,
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions), collapsedCardIds: new Set(savedCollapsedCards), quickPhrases: savedQuickPhrases, quickPhraseEditorOpen: false,
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 }, mapCardSessionSwitches: new Set(),
  expandedMessageIds: new Set(),
  expandedAttachmentCards: new Set(),
  attachmentNotice: null,
  attachmentPreview: null,
  attachmentPreviewOpening: false,
  attachmentMenu: null,
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false,
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(),
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const currentThread = () => state.workspace?.threads.find(thread => thread.id === state.activeId) ?? state.workspace?.threads[0] ?? null
const threadListTitle = thread => thread.dshSessionTitle ?? thread.title ?? questionFor(thread)
let mapEpoch = 0
const mapRequests = new Set()

function rememberBranchAnchor(sessionId, cardId) {
  state.branchAnchors.set(sessionId, cardId)
  try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCardPositions() {
  try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCollapsedCards() {
  if (state.browserMode === 'session') return
  try { localStorage.setItem(COLLAPSED_CARDS_KEY, JSON.stringify([...state.collapsedCardIds])) } catch { /* Private browsing may disable local storage. */ }
}

function persistQuickPhrases() {
  try { localStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(state.quickPhrases)) } catch { /* Private browsing may disable local storage. */ }
}

function rememberCardPosition(cardId, position, aliases = []) {
  if (state.browserMode === 'session') { state.sessionPositions.set(cardId, { ...position }); return }
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions()
}

function resetCardPositions() {
  state.cardPositions.clear()
  persistCardPositions()
  try {
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
  } catch { /* Private browsing may disable local storage. */ }
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const signal = options.signal
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 8000)
  mapRequests.add(controller)
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? '请求失败')
    return body
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DSH 请求已取消或超时，请重试')
    throw error
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    mapRequests.delete(controller)
  }
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
}

function dshRpc(type, payload = {}) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = crypto.randomUUID()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, 20_000)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { if (!mapInteractive) return; state.error = error instanceof Error ? error.message : error; render() }

function messagesFromEvents(events) {
  if (!Array.isArray(events)) return []
  return events.flatMap(event => {
    const content = event?.data?.message?.content ?? event?.data?.content
    const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n') : ''
    if (event?.type === 'user/message' && text && !text.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return [{ kind: 'user', text, at: event.time, sourceSeq: event.seq }]
    if (event?.type === 'assistant/message' && text) return [{ kind: 'assistant', text, at: event.time, sourceSeq: event.seq }]
    return []
  })
}

async function loadThreadHistory() {}

function canReplaceView() {
  return state.draft === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function currentDshWorkspace() {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? state.dshWorkspaces.find(workspace => workspace.sessionIds.includes(id)) : undefined
}

function selectedDshWorkspace() {
  return state.dshWorkspaces.find(workspace => workspace.id === state.selectedDshWorkspaceId)
}

function currentDshThread(threads = state.workspace?.threads ?? []) {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

function workspaceChoices() {
  const all = {id:'all',title:'全部会话',path:null,sessionIds:[],source:'all'}
  if (state.dshWorkspaces.length > 0) return [all,...state.dshWorkspaces.map(workspace => ({ ...workspace, source: 'dsh' }))]
  return [all,...state.summaries.map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.cwd, sessionIds: [], source: 'projection' }))]
}

async function threadsForDshWorkspace(workspace, { signal } = {}) {
  if (workspace.sessionIds.length === 0) return []
  const requested = new Set(workspace.sessionIds)
  const projections = await Promise.all(state.summaries.map(summary => api(`/synapse/api/workspaces/${summary.id}`, { signal })))
  return projections.flatMap(projection => projection.workspace.threads.filter(thread => requested.has(thread.dshSessionId)))
}

async function openDshWorkspace(id, { renderAfter = true, preserveCanvasCamera = false, signal } = {}) {
  const workspace = state.dshWorkspaces.find(item => item.id === id)
  if (workspace === undefined) return false
  if (state.selectedDshWorkspaceId !== id) resetAttachmentInteraction()
  const load = ++state.workspaceLoad
  state.selectedDshWorkspaceId = id
  const threads = await threadsForDshWorkspace(workspace, { signal })
  if (load !== state.workspaceLoad || signal?.aborted) return true
  const nextWorkspaceId = `dsh:${workspace.id}`
  if (state.workspace?.id !== nextWorkspaceId && !preserveCanvasCamera) resetCanvasCamera()
  state.workspace = { id: nextWorkspaceId, title: workspace.title, cwd: workspace.path, threads }
  const currentThread = currentDshThread(state.workspace.threads)
  state.activeId = currentThread?.id ?? (state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null)
  if (currentThread !== undefined) revealConversationThread(conversationCards(state.workspace.threads), currentThread.id)
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
  return true
}

async function openCurrentWorkspace({ preserveCanvasCamera = false } = {}) {
  const workspace = currentDshWorkspace()
  if (workspace === undefined || workspace.id === state.selectedDshWorkspaceId) return false
  return openDshWorkspace(workspace.id, { preserveCanvasCamera })
}

async function refreshSummaries({ renderAfter = true, signal } = {}) {
  const epoch = mapEpoch
  const body = await api('/synapse/api/workspaces', { signal })
  if (epoch !== mapEpoch || signal?.aborted || !mapInteractive) return false
  const changed = JSON.stringify(state.summaries) !== JSON.stringify(body.workspaces)
  state.summaries = body.workspaces
  if (changed || state.workspace === null) {
    const projections = await fetchAllProjections(signal)
    if (epoch !== mapEpoch || signal?.aborted || !mapInteractive) return false
    state.allProjections = projections
    if (state.selectedDshWorkspaceId === null) state.workspace = aggregateWorkspace(projections)
    else await openDshWorkspace(state.selectedDshWorkspaceId, { renderAfter: false, signal })
    if (searchController.snapshot().open) searchController.refresh(searchRecords(projections))
    if (state.browserMode === 'session' && !state.workspace?.threads.some(t => t.dshSessionId === state.sessionTarget)) returnGlobal({renderAfter:false})
    if (renderAfter && canReplaceView()) render()
  }
  return changed
}

async function openWorkspace(id, { renderAfter = true, signal } = {}) {
  if (state.workspace?.id !== id) resetAttachmentInteraction()
  const load = ++state.workspaceLoad
  const body = await api(`/synapse/api/workspaces/${id}`, { signal })
  if (load !== state.workspaceLoad || signal?.aborted) return
  if (state.workspace?.id !== body.workspace.id) resetCanvasCamera()
  state.workspace = body.workspace
  state.activeId = state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
}

async function refreshProjection() { return refreshSummaries() }

function openNewSession() {
  if (state.browserMode === 'session') returnGlobal({renderAfter:false})
  if (state.draft !== null) return
  cancelSessionLocate()
  resetAttachmentInteraction()
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  state.inspectorOpening = false
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'new', text: '', sending: false }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function archiveThread(thread) {
  if (!window.confirm(`归档画布中的「${thread.title}」及其分支？DSH 原会话会保留，可在 DSH 内继续查看。`)) return
  cancelSessionLocate()
  resetAttachmentInteraction()
  await api(`/synapse/api/threads/${thread.id}`, { method: 'DELETE' })
  state.historyBySession.delete(thread.dshSessionId)
  state.detailScrollByThread.delete(thread.id)
  state.detailTargetCardId = state.detailThreadId === thread.id ? null : state.detailTargetCardId
  if (state.workspace !== null) {
    const removed = new Set([thread.id])
    for (let changed = true; changed;) {
      changed = false
      for (const item of state.workspace.threads) {
        if (item.parentId !== null && removed.has(item.parentId) && !removed.has(item.id)) {
          removed.add(item.id)
          changed = true
        }
      }
    }
    state.workspace.threads = state.workspace.threads.filter(item => !removed.has(item.id))
    for (const key of [...state.cardPositions.keys()]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) state.cardPositions.delete(key)
    }
    let collapsedChanged = false
    for (const key of [...state.collapsedCardIds]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) {
        state.collapsedCardIds.delete(key)
        collapsedChanged = true
      }
    }
    if (collapsedChanged) persistCollapsedCards()
    state.activeId = state.activeId !== null && state.workspace.threads.some(item => item.id === state.activeId)
      ? state.activeId
      : state.workspace.threads[0]?.id ?? null
    render()
  } else {
    state.activeId = null
  }
  await refreshSummaries()
}

function focusDraftInput() {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement)) return
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function openContinue(parent, anchorId = undefined, text = '') {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text, sending: false }
  render()
  window.setTimeout(focusDraftInput, 0)
}

function openBranch(parent, atSeq = undefined, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'branch', parentId: parent.id, atSeq, anchorId, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
  state.error = ''
  render()
  try {
    await dshRpc('synapse:send-message', { sessionId: thread.dshSessionId, text })
    void loadThreadHistory(thread)
  } catch (error) {
    state.pendingReplies.delete(thread.dshSessionId)
    render()
    throw error
  }
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft === null || !text) return
  const branchPosition = draft.kind === 'branch' && state.workspace !== null ? draftPlacement(conversationCards(state.workspace.threads))?.position : undefined
  draft.sending = true
  state.error = ''
  render()
  try {
    if (draft.kind === 'new') {
      const session = await dshRpc('synapse:create-session', { workspaceId: state.selectedDshWorkspaceId, cwd: state.currentDsh?.cwd })
      await dshRpc('synapse:send-message', { sessionId: session.id, text })
      state.draft = null
      render()
      window.setTimeout(() => {
        void refreshProjection().catch(() => {})
      }, 150)
      return
    }
    const parent = state.workspace?.threads.find(thread => thread.id === draft.parentId)
    if (parent === undefined) throw new Error('来源会话不存在')
    if (draft.kind === 'continue') {
      state.draft = null
      await sendMessage(parent, text)
      return
    }
    const session = await dshRpc('synapse:fork-session', { sessionId: parent.dshSessionId, atSeq: draft.atSeq })
    if (draft.anchorId !== undefined) rememberBranchAnchor(session.id, draft.anchorId)
    const result = await api(`/synapse/api/threads/${parent.id}/branch`, { method: 'POST', body: JSON.stringify({ title: text.slice(0, 42), dshSessionId: session.id, dshSessionTitle: session.title, position: branchPosition }) })
    if (state.workspace !== null && !state.workspace.threads.some(thread => thread.id === result.thread.id || thread.dshSessionId === result.thread.dshSessionId)) state.workspace.threads.push(result.thread)
    state.activeId = result.thread.id
    state.draft = null
    state.pendingReplies.set(result.thread.dshSessionId, { text, at: Date.now() })
    render()
    await dshRpc('synapse:send-message', { sessionId: result.thread.dshSessionId, text })
    void loadThreadHistory(result.thread)
    await refreshProjection()
  } catch (error) {
    if (draft.kind === 'branch') {
      state.pendingReplies.delete(state.workspace?.threads.find(thread => thread.id === state.activeId)?.dshSessionId)
      if (state.draft !== null) state.draft = { ...draft, sending: false }
    } else {
      state.draft = { ...draft, sending: false }
    }
    setError(error)
  }
}

function threadsById() { return new Map((state.workspace?.threads ?? []).map(thread => [thread.id, thread])) }
function persistedMessagesFor(thread) { return state.historyBySession.get(thread.dshSessionId) ?? thread.messages ?? [] }

function pendingUserIndex(messages, pending) {
  return messages.findLastIndex(message => message.kind === 'user' && message.text === pending.text && new Date(message.at).getTime() >= pending.at - 2_000)
}

function settlePendingReply(thread, messages) {
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return false
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex === -1 || !messages.slice(userIndex + 1).some(message => message.kind === 'assistant')) return false
  state.pendingReplies.delete(thread.dshSessionId)
  return true
}

function messagesFor(thread) {
  // A runtime-context snapshot is internal DSH state, never a user turn.
  // Filter here as well as during persistence so existing saved workspaces
  // immediately render one question and its answer as one card.
  const messages = persistedMessagesFor(thread).filter(message => !(message.kind === 'user' && typeof message.text === 'string' && message.text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')))
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return messages
  if (settlePendingReply(thread, messages)) {
    state.liveReplies.delete(thread.dshSessionId)
    return messages
  }
  const liveReply = state.liveReplies.get(thread.dshSessionId)
  const liveAssistant = liveReply?.running ? { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() } : { kind: 'assistant', text: '', pending: true, at: new Date().toISOString() }
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex !== -1) return [...messages, liveAssistant]
  return [...messages, { kind: 'user', text: pending.text, pending: true, at: new Date(pending.at).toISOString() }, liveAssistant]
}

function latestMessage(thread, kind) { return [...messagesFor(thread)].reverse().find(message => message.kind === kind) }
function questionFor(thread) { return latestMessage(thread, 'user')?.text ?? thread.dshSessionTitle ?? '等待用户提问' }
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

function markdownBlock(text) {
  const lines = text.split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      const matcher = unordered === null ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (item === null) break
        items.push(`<li>${inlineMarkdown(item[1])}</li>`)
        index++
      }
      output.push(`<${unordered === null ? 'ol' : 'ul'}>${items.join('')}</${unordered === null ? 'ol' : 'ul'}>`)
      continue
    }
    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-*+]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  const parts = key.split(/```/)
  const rendered = parts.map((part, index) => index % 2 === 1
    ? `<pre><code>${escapeHtml(part.replace(/^\w*\n/, ''))}</code></pre>`
    : markdownBlock(part)).join('')
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

function overlapsCard(position, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + CARD_HEIGHT && position.y + CARD_HEIGHT > other.y
}

function firstAvailableCardPosition(position, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + CARD_HEIGHT + CARD_GAP_Y))
  }
}

function connectorPath(fromPosition, toPosition) {
  const fromX = fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const toX = toPosition.x
  const toY = toPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function connectorPathFromElements(fromCard, toCard) {
  const fromX = Number.parseFloat(fromCard.style.left) + CARD_WIDTH
  const fromY = Number.parseFloat(fromCard.style.top) + CARD_HEIGHT / 2
  const toX = Number.parseFloat(toCard.style.left)
  const toY = Number.parseFloat(toCard.style.top) + CARD_HEIGHT / 2
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Connector paths are rebuilt together with the canvas DOM; cache the mapping
// from card id to its incident paths so dragging never scans the whole SVG.
let connectorPathsByCard = new Map()
function cacheCardConnectors() {
  connectorPathsByCard = new Map()
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  for (const path of viewport.querySelectorAll('.connectors path[data-from]')) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    for (const id of [fromId, toId]) {
      const paths = connectorPathsByCard.get(id)
      if (paths === undefined) connectorPathsByCard.set(id, new Set([path]))
      else paths.add(path)
    }
  }
}

function refreshCardConnectors(cardId) {
  const paths = connectorPathsByCard.get(cardId)
  if (paths === undefined || paths.size === 0) return
  const byId = state.canvasCardsById
  if (byId === undefined) return
  for (const path of paths) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = byId.get(fromId)
    const toCard = byId.get(toId)
    if (fromCard === undefined || toCard === undefined) continue
    // Data-driven endpoints: the counterpart card may be unmounted (outside
    // the viewport) but its position is still authoritative.
    path.setAttribute('d', state.browserMode === 'session' ? SynapseSessionCanvas.connectorPath(fromCard,toCard) : connectorPath(fromCard.position, toCard.position))
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  // Focus the active conversation's latest turn, not its first: after many
  // rounds the canvas should open where work is happening, at the newest card.
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const active = activeCards.at(-1)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  const saved = new Map(cards.flatMap(card => {
    if (card.positionLocked !== true) return []
    const position = state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  const occupied = []
  for (const card of cards) {
    const position = saved.get(card.id)
    if (position !== undefined) {
      card.position = position
      continue
    }
    card.position = firstAvailableCardPosition(card.naturalPosition ?? card.position, occupied)
    occupied.push(card.position)
  }
  return cards
}

function layoutConversationGraph(cards, threads) {
  const childrenByThread = new Map()
  for (const thread of threads) {
    if (thread.parentId === null) continue
    const children = childrenByThread.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByThread.set(thread.parentId, children)
  }
  const laneByThread = new Map()
  const visitThread = threadId => {
    if (laneByThread.has(threadId)) return
    laneByThread.set(threadId, laneByThread.size)
    for (const childId of childrenByThread.get(threadId) ?? []) visitThread(childId)
  }
  for (const thread of threads) if (thread.parentId === null) visitThread(thread.id)
  for (const thread of threads) visitThread(thread.id)

  const byId = new Map(cards.map(card => [card.id, card]))
  const positioned = new Map()
  const positionFor = (card, visiting = new Set()) => {
    if (positioned.has(card.id)) return positioned.get(card.id)
    if (visiting.has(card.id)) return { x: 86, y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y) }
    visiting.add(card.id)
    const parent = card.parentId === null ? undefined : byId.get(card.parentId)
    const parentPosition = parent === undefined ? undefined : positionFor(parent, visiting)
    const position = {
      x: parentPosition === undefined ? 86 : parentPosition.x + 365,
      y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y),
    }
    visiting.delete(card.id)
    positioned.set(card.id, position)
    return position
  }
  for (const card of cards) {
    card.naturalPosition = positionFor(card)
    if (!card.positionLocked) card.position = card.naturalPosition
  }
  return placeConversationCards(cards)
}

function conversationCards(threads, {layout=true} = {}) {
  const cards = []
  const cardsByThread = new Map()
  for (const thread of threads) {
    const messages = messagesFor(thread)
    const turns = []
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const question = messages[messageIndex]
      if (question.kind !== 'user') continue
      const replies = []
      const errors = []
      let processCount = 0
      for (let replyIndex = messageIndex + 1; replyIndex < messages.length; replyIndex++) {
        const reply = messages[replyIndex]
        if (reply.kind === 'user') break
        if (reply.kind === 'assistant') replies.push(reply)
        if (reply.kind === 'error') errors.push(reply)
        if (Array.isArray(reply.process)) processCount += reply.process.length
        else if (reply.kind === 'tool') processCount += 1
      }
      const answer = replies.at(-1) ?? null
      const error = errors.at(-1) ?? null
      const attachments = turnAttachments(question, replies, errors)
      const turnIndex = turns.length
      const id = `${thread.id}:turn:${question.sourceSeq ?? messageIndex}`
      const previous = turns.at(-1)
      const positionKey = `${thread.id}:turn-index:${turnIndex}`
      const naturalPosition = previous === undefined ? { x: 86, y: 82 } : { x: previous.naturalPosition.x + 365, y: previous.naturalPosition.y }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      const position = positionLocked ? savedPosition : naturalPosition
      turns.push({
        id,
        positionKey,
        dshThreadId: thread.id,
        dshSessionId: thread.dshSessionId,
        sourceParentId: thread.parentId,
        parentId: null,
        sourceSeq: question.sourceSeq,
        turnIndex,
        naturalPosition,
        position,
        positionLocked,
        question: question.text,
        answer,
        error,
        processCount,
        attachments,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.answer === null || latestTurn.answer.pending === true)) latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() }
    if (turns.length === 0) {
      const id = `${thread.id}:turn:empty`
      const positionKey = `${thread.id}:turn-index:0`
      const naturalPosition = { x: 86, y: 82 }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
      id,
      positionKey,
      dshThreadId: thread.id,
      dshSessionId: thread.dshSessionId,
      sourceParentId: thread.parentId,
      parentId: null,
      sourceSeq: undefined,
      turnIndex: 0,
      naturalPosition,
      position: positionLocked ? savedPosition : naturalPosition,
      positionLocked,
      question: thread.dshSessionTitle ?? thread.title,
      answer: null,
      error: null,
      processCount: 0,
      })
    }
    turns.at(-1).canContinue = true
    cardsByThread.set(thread.id, turns)
    cards.push(...turns)
  }
  for (const card of cards) {
    const siblings = cardsByThread.get(card.dshThreadId)
    if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
    else {
      const parentCards = cardsByThread.get(card.sourceParentId)
      const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
      const firstChildQuestion = siblings?.[0]
      const seedLength = sourceThread?.sourceSeedLength ?? firstChildQuestion?.sourceSeq
      // A fork inherits every parent event before DSH's durable seed boundary.
      // The latest parent question below that boundary is the exact Turn where
      // this child was born. Canvas coordinates never participate in lineage.
      const inheritedTurn = Number.isSafeInteger(seedLength)
        ? parentCards?.filter(candidate => Number.isInteger(candidate.sourceSeq) && candidate.sourceSeq < seedLength).at(-1)
        : undefined
      card.parentId = state.branchAnchors.get(card.dshThreadId) ?? inheritedTurn?.id ?? null
    }
  }
  return layout ? layoutConversationGraph(cards, threads) : cards
}

function conversationGraphView(cards, collapsedCardIds = state.collapsedCardIds) {
  const cardIds = new Set(cards.map(card => card.id))
  const childrenByParent = new Map()
  for (const card of cards) {
    if (card.parentId === null || !cardIds.has(card.parentId)) continue
    const children = childrenByParent.get(card.parentId) ?? []
    children.push(card.id)
    childrenByParent.set(card.parentId, children)
  }

  const hiddenIds = new Set()
  for (const rootId of collapsedCardIds) {
    if (!cardIds.has(rootId)) continue
    const visited = new Set([rootId])
    const visit = parentId => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        hiddenIds.add(childId)
        visit(childId)
      }
    }
    visit(rootId)
  }

  // Persisted collapse roots must remain visible even if malformed metadata
  // contains a cycle where two collapsed nodes otherwise hide each other.
  for (const rootId of collapsedCardIds) hiddenIds.delete(rootId)

  // Post-order accumulation: each card's descendant count is 1 + the sum of
  // its children's subtree sizes, so the whole graph is O(n) instead of a BFS
  // from every card (O(n²) on deep chains). Malformed parent cycles are
  // detected through the DFS path: every member of a cycle reaches every other
  // member plus the union of their off-cycle subtrees, so when the cycle entry
  // pops last, all members are settled to (cycleSize - 1) + off-cycle total,
  // which matches the per-card BFS' unique-descendant count.
  const descendantCounts = new Map()
  const inStack = new Set()
  for (const card of cards) {
    if (descendantCounts.has(card.id)) continue
    const stack = [{ id: card.id, children: childrenByParent.get(card.id) ?? [], index: 0 }]
    const path = [card.id]
    let cycleEntry = null
    let cycleMembers = null
    let cycleOffCycleTotal = 0
    inStack.add(card.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index < top.children.length) {
        const childId = top.children[top.index++]
        if (descendantCounts.has(childId)) continue
        if (inStack.has(childId)) {
          // Back edge: the nodes from childId up to top.id form a cycle.
          cycleEntry = childId
          cycleMembers = new Set(path.slice(path.indexOf(childId)))
          cycleOffCycleTotal = 0
          continue
        }
        inStack.add(childId)
        path.push(childId)
        stack.push({ id: childId, children: childrenByParent.get(childId) ?? [], index: 0 })
      } else {
        stack.pop()
        path.pop()
        inStack.delete(top.id)
        let count = 0
        for (const childId of top.children) {
          if (cycleMembers !== null && cycleMembers.has(childId)) continue // ring edge; base count added below
          count += 1 + (descendantCounts.get(childId) ?? 0)
        }
        if (cycleMembers !== null && cycleMembers.has(top.id)) cycleOffCycleTotal += count
        if (cycleMembers !== null && top.id === cycleEntry) {
          // All cycle members have popped (the entry pops last in post-order);
          // settle them so ancestors popping next read the final counts.
          const base = cycleMembers.size - 1
          for (const id of cycleMembers) descendantCounts.set(id, base + cycleOffCycleTotal)
          cycleEntry = null
          cycleMembers = null
        } else {
          descendantCounts.set(top.id, count)
        }
      }
    }
  }

  return {
    cards: cards.filter(card => !hiddenIds.has(card.id)),
    childCounts: new Map(cards.map(card => [card.id, childrenByParent.get(card.id)?.length ?? 0])),
    descendantCounts,
  }
}

function revealConversationThread(cards, threadId) {
  const byId = new Map(cards.map(card => [card.id, card]))
  let changed = false
  for (const target of cards.filter(card => card.dshThreadId === threadId)) {
    const visited = new Set([target.id])
    let parentId = target.parentId
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId)
      if (state.collapsedCardIds.delete(parentId)) changed = true
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  if (changed) persistCollapsedCards()
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = cards.map(card => {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (parent === undefined || parent === null) return ''
    const active = (card.dshThreadId === state.activeId && parent.dshThreadId === state.activeId ? ' active-connector' : '') + (state.browserMode === 'session' && card.dshThreadId !== parent.dshThreadId ? ' session-branch-connector' : '')
    return `<path class="${active.trim()}" data-from="${escapeHtml(parent.id)}" data-to="${escapeHtml(card.id)}" d="${state.browserMode === 'session' ? SynapseSessionCanvas.connectorPath(parent, card) : connectorPath(parent.position, card.position)}"></path>`
  })
  const placement = draftPlacement(cards)
  if (placement !== null) {
    links.push(`<path class="draft-connector" data-from="${escapeHtml(placement.parent.id)}" data-to="draft" d="${connectorPath(placement.parent.position, placement.position)}"></path>`)
  }
  return links.join('')
}

/** How many chips a collapsed strip shows before it folds into `+N`. */
const ATTACHMENT_VISIBLE_LIMIT = 2

/**
 * The bottom row of attachments on one turn card.
 *
 * A card with no attachments renders nothing at all, so an empty card keeps
 * exactly the height it had before this feature. Individual attachments never
 * render a blank slot: the host already replaced missing names with a
 * placeholder and unknown kinds with a generic label.
 *
 * @param attachments - display objects from the host projection.
 * @param cardId - the card the strip belongs to, used as the toggle key.
 */
let attachmentNoticeTimer = 0
let attachmentActionTimer = 0
let attachmentActionPending = null

/** How long an open/reveal request may stay unanswered before we say so. */
const ATTACHMENT_ACTION_TIMEOUT_MS = 6000

// Navigation uses stable session/thread IDs and the existing latest-turn rule.
const LOCATE_HIGHLIGHT_MS = 1500
let locateRevision = 0
let locateController = null
let locateFrame = 0
let locateTimer = 0
let layoutFrame = 0
let locatedCardId = null
let lastNavigationCardId = null
let locatedUntil = 0
let layoutObserver = null
let observedViewport = null
let observedPanel = null
let layoutSignature = ''
let mapInteractive = window.parent === window
let attachmentRevision = 0
let attachmentController = null
let previewFocusFrame = 0

function latestSessionCard(cards, threads, sessionId) {
  const thread = threads.find(item => item.dshSessionId === sessionId)
  return thread === undefined ? null : cards.filter(card => card.dshThreadId === thread.id).at(-1) ?? null
}

// Rectangles are CSS pixels relative to the viewport. Browser zoom is already
// represented by DOM measurements and must never be multiplied in again.
function unobscuredRect(width, height, occluders) {
  let area = { x: 0, y: 0, width, height }
  for (const box of occluders) {
    const left = Math.max(area.x, box.x), top = Math.max(area.y, box.y)
    const right = Math.min(area.x + area.width, box.x + box.width)
    const bottom = Math.min(area.y + area.height, box.y + box.height)
    if (right <= left || bottom <= top) continue
    const options = [
      { x: area.x, y: area.y, width: left - area.x, height: area.height },
      { x: right, y: area.y, width: area.x + area.width - right, height: area.height },
      { x: area.x, y: area.y, width: area.width, height: top - area.y },
      { x: area.x, y: bottom, width: area.width, height: area.y + area.height - bottom },
    ]
    area = options.sort((a, b) => b.width * b.height - a.width * a.height)[0]
  }
  return area
}

function visibleCanvasRect(viewport) {
  const bounds = viewport.getBoundingClientRect()
  const panels = [...document.querySelectorAll('[data-map-panel], .card-inspector')].map(panel => {
    // offset dimensions ignore opening/closing transforms; measure final layout.
    const parent = panel.offsetParent?.getBoundingClientRect() ?? bounds
    return { x: parent.left + panel.offsetLeft - bounds.left, y: parent.top + panel.offsetTop - bounds.top, width: panel.offsetWidth, height: panel.offsetHeight }
  })
  return unobscuredRect(bounds.width, bounds.height, panels)
}

function cameraForCard(position, size, area, currentZoom) {
  const fit = Math.min(Math.max(1, area.width - 32) / size.width, Math.max(1, area.height - 32) / size.height)
  const zoom = Math.max(.6, Math.min(4, currentZoom, fit))
  return { zoom, x: area.x + area.width / 2 - (position.x + size.width / 2) * zoom, y: area.y + area.height / 2 - (position.y + size.height / 2) * zoom }
}

function centerCanvasCard(card, { dismissOverlayIfNeeded = false } = {}) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement) || viewport.clientWidth === 0 || viewport.clientHeight === 0) return false
  let area = visibleCanvasRect(viewport)
  if ((area.width < CARD_WIDTH * .6 + 32 || area.height < CARD_HEIGHT * .6 + 32) && (state.attachmentPreview !== null || state.inspectorCardId !== null)) {
    if (!dismissOverlayIfNeeded) return false
    // A very narrow window cannot show a readable overlay and a whole card.
    // Dismiss the overlay for explicit navigation instead of hiding the target.
    resetAttachmentInteraction()
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
    area = visibleCanvasRect(document.querySelector('.canvas-viewport'))
  }
  const place = size => {
    const next = cameraForCard(card.position, size, area, state.zoom)
    state.zoom = next.zoom
    state.canvasCamera = { x: next.x, y: next.y }
    state.canvasViewInitialized = true
    state.canvasNeedsCenter = false
    applyCanvasTransform()
    syncCanvasViewport()
  }
  place({ width: CARD_WIDTH, height: CARD_HEIGHT })
  const element = document.querySelector(`.thread-card[data-card-id="${selectorValue(card.id)}"]`)
  if (element instanceof HTMLElement) place({ width: element.offsetWidth || CARD_WIDTH, height: element.offsetHeight || CARD_HEIGHT })
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
  return element instanceof HTMLElement
}

function clearLocateHighlight() {
  window.clearTimeout(locateTimer)
  locateTimer = 0
  locatedCardId = null
  locatedUntil = 0
  for (const card of document.querySelectorAll('.is-locate-target')) card.classList.remove('is-locate-target')
}

function restoreLocateHighlight() {
  if (!mapInteractive || locatedCardId === null || Date.now() >= locatedUntil) return
  document.querySelector(`.thread-card[data-card-id="${selectorValue(locatedCardId)}"]`)?.classList.add('is-locate-target')
}

function highlightLocatedCard(cardId) {
  clearLocateHighlight()
  lastNavigationCardId = cardId
  locatedCardId = cardId
  locatedUntil = Date.now() + LOCATE_HIGHLIGHT_MS
  restoreLocateHighlight()
  locateTimer = window.setTimeout(clearLocateHighlight, LOCATE_HIGHLIGHT_MS)
  const status = document.querySelector('.navigation-status')
  if (status !== null) status.textContent = '已定位到所选会话的最后一轮'
}

function cancelSessionLocate() {
  locateRevision++
  lastNavigationCardId = null
  locateController?.abort()
  locateController = null
  window.cancelAnimationFrame(locateFrame)
  locateFrame = 0
  clearLocateHighlight()
}

async function locateSession(sessionId, { refresh = true, cardId = null, sessionMode = true, animate = true } = {}) {
  const replaySequence = state.browserMode !== 'session' || state.sessionTarget !== sessionId
  cancelSessionLocate()
  searchAttachmentRevision++
  rgbSequence.cancel()
  const revision = locateRevision
  locateController = new AbortController()
  const signal = locateController.signal
  const current = () => revision === locateRevision && mapInteractive && !signal.aborted
  if (!current() || typeof sessionId !== 'string' || sessionId === '') return
  if (state.draft !== null) return setError('请先完成或取消正在编辑的消息，再定位会话')
  try {
    let threads = state.workspace?.threads ?? []
    if (!threads.some(t => t.dshSessionId === sessionId) && refresh) {
      const projections = await fetchAllProjections(signal)
      if (!current()) return
      state.allProjections = projections
      state.workspace = aggregateWorkspace(projections)
      state.selectedDshWorkspaceId = null
      threads = state.workspace.threads
    }
    const cards = conversationCards(threads, {layout:false})
    const target = cardId === null ? (sessionMode ? cards.find(c=>c.dshSessionId === sessionId) : latestSessionCard(cards, threads, sessionId)) : cards.find(c => c.id === cardId && c.dshSessionId === sessionId)
    if (!target) { if (current()) setError('地图中没有此会话的目标卡片，可能尚未同步或已归档'); return }
    if (sessionMode) enterSessionMode(sessionId)
    state.mode = 'canvas'
    state.activeId = target.dshThreadId
    state.selectedCardId = cardId
    state.error = ''
    resetAttachmentInteraction()
    searchController.closeFlyout()
    state.inspectorCardId = null
    state.inspectorOpening = false
    revealConversationThread(cards, target.dshThreadId)
    render()
    locateFrame = window.requestAnimationFrame(() => {
      locateFrame = 0
      if (!current()) return
      const rendered = state.canvasCardsById?.get(target.id)
      if (rendered && centerCanvasCard(rendered, { dismissOverlayIfNeeded: true })) {
        lastNavigationCardId = rendered.id
        if (animate && sessionMode && replaySequence) rgbSequence.start(sessionLayout(cards, threads).orderedIds)
        else if (!animate || !sessionMode) highlightLocatedCard(rendered.id)
      } else setError('目标卡片尚无法呈现，请稍后重试定位')
    })
  } catch (error) { if (current()) setError(error) }
}

function observeCanvasLayout() {
  const viewport = document.querySelector('.canvas-viewport')
  const panel = document.querySelector('[data-map-panel], .card-inspector')
  if (viewport === observedViewport && panel === observedPanel) return
  layoutObserver?.disconnect()
  observedViewport = viewport
  observedPanel = panel
  if (!mapInteractive || !(viewport instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
  layoutObserver ??= new ResizeObserver(() => {
    window.cancelAnimationFrame(layoutFrame)
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0
      if (!mapInteractive || state.mode !== 'canvas' || state.dragging || state.canvasGesture) return
      const liveViewport = document.querySelector('.canvas-viewport')
      if (!(liveViewport instanceof HTMLElement)) return
      const area = visibleCanvasRect(liveViewport)
      const signature = JSON.stringify(area)
      if (previewController.snapshot().open && liveViewport.clientWidth < 1100 && state.leftPanel) {state.leftPanel=null;updateFeaturePanels();return}
      if (signature === layoutSignature) return
      layoutSignature = signature
      if (state.browserMode === 'session') { render(); return }
      const cardId = state.attachmentPreview?.cardId ?? state.inspectorCardId ?? locatedCardId ?? state.selectedCardId ?? lastNavigationCardId
      const card = state.canvasCardsById?.get(cardId)
      if (card !== undefined) centerCanvasCard(card)
      else syncCanvasViewport()
    })
  })
  layoutObserver.observe(viewport)
  for (const item of document.querySelectorAll('[data-map-panel], .card-inspector')) layoutObserver.observe(item)
}

function cancelAttachmentAction() {
  attachmentRevision++
  attachmentController?.abort()
  attachmentController = null
  window.clearTimeout(attachmentActionTimer)
  window.clearTimeout(attachmentNoticeTimer)
  attachmentActionPending = null
  state.attachmentNotice = null
}

function resetAttachmentInteraction() {
  previewController.closePreview()
  if (state.leftPanel === 'attachment') state.leftPanel = null
  cancelAttachmentAction()
  window.clearTimeout(previewCloseTimer)
  window.cancelAnimationFrame(previewFocusFrame)
  previewCloseTimer = 0
  previewFocusFrame = 0
  state.attachmentPreview = null
  state.attachmentPreviewOpening = false
  state.attachmentMenu = null
}

function suspendMapInteraction() {
  mapInteractive = false
  cancelCanvasGesture?.()
  cancelCardDrag?.()
  cancelCardDrag = null
  cancelCanvasGesture = null
  rgbSequence.cancel()
  searchController.close()
  cancelPanelAnimations()
  state.leftPanel = null
  mapEpoch++
  for (const request of mapRequests) request.abort()
  mapRequests.clear()
  cancelSessionLocate()
  lastNavigationCardId = null
  resetAttachmentInteraction()
  state.workspaceLoad++
  state.inspectorCardId = null
  window.clearTimeout(inspectorCloseTimer)
  window.clearTimeout(liveRenderTimer)
  window.cancelAnimationFrame(liveCardFrame)
  liveRenderTimer = 0
  liveCardFrame = 0
  window.cancelAnimationFrame(layoutFrame)
  layoutFrame = 0
  layoutObserver?.disconnect()
  observedViewport = null
  observedPanel = null
}

window.addEventListener('pagehide', suspendMapInteraction)


/** Find an attachment by its stable key within its owning conversation. */
function findAttachmentByKey(key, context = null) {
  for (const thread of state.workspace?.threads ?? []) {
    if (context?.sessionId && thread.dshSessionId !== context.sessionId) continue
    for (const message of thread.messages ?? []) {
      for (const list of [message.attachments, message.deliverables]) {
        if (!Array.isArray(list)) continue
        for (const item of list) if (item?.key === key && (!Number.isInteger(context?.seq) || item.messageSeq === context.seq)) return item
      }
    }
  }
  return null
}

/** The attachment a panel or menu action currently applies to. */
function attachmentActionTarget() {
  const focused = document.activeElement?.closest?.('[data-panel-side="right"]')
  if (focused && previewController.snapshot().open) return previewController.snapshot().identity
  return state.attachmentMenu?.target ?? state.attachmentPreview ?? null
}

let previewCloseTimer = 0

/**
 * Select an attachment for the left preview panel.
 *
 * Mirrors the card inspector on the right: same open/close transition, and the
 * two panels are mutually exclusive so they never squeeze the canvas from both
 * sides at once. Clicking the already-previewed chip toggles it away.
 */
function openAttachmentPreview(chip) {
  const wasAttachmentOpen = state.leftPanel === 'attachment'
  searchController.closeFlyout()
  previewController.closePreview()
  state.leftPanel = 'attachment'
  state.selectedAttachment = { ...chip }
  cancelAttachmentAction()
  window.cancelAnimationFrame(previewFocusFrame)
  state.attachmentMenu = null
  if (wasAttachmentOpen && state.attachmentPreview?.key === chip.key && state.attachmentPreview?.cardId === chip.cardId && state.attachmentPreview?.sessionId === chip.sessionId) {
    closeAttachmentPreview()
    return
  }
  if (previewCloseTimer !== 0) {
    window.clearTimeout(previewCloseTimer)
    previewCloseTimer = 0
  }
  closeCardInspector({ animate: false })
  state.attachmentPreviewOpening = state.attachmentPreview === null
  state.attachmentPreview = {
    key: chip.key,
    cardId: chip.cardId,
    sessionId: chip.sessionId,
    seq: chip.seq,
    name: chip.name,
    path: chip.path,
  }
  render()
  previewFocusFrame = window.requestAnimationFrame(() => {
    previewFocusFrame = 0
    if (mapInteractive && state.attachmentPreview?.cardId === chip.cardId && state.attachmentPreview?.key === chip.key) document.querySelector('.attachment-preview-close')?.focus({ preventScroll: true })
  })
}

function closeAttachmentPreview({ animate = true, restoreFocus = true } = {}) {
  if (state.attachmentPreview === null) return
  const chip = state.attachmentPreview
  const hadFocus = Boolean(document.activeElement?.closest?.('.attachment-preview'))
  resetAttachmentInteraction()
  render()
  if (restoreFocus && hadFocus) {
    const trigger = [...document.querySelectorAll('[data-action="open-attachment"]')].find(item => item.dataset.key === chip.key && item.dataset.card === chip.cardId && item.dataset.session === chip.sessionId)
    const fallback = document.querySelector('[data-action="focus-active"]')
    ;(trigger ?? fallback)?.focus({ preventScroll: true })
  }
}

/** Right-click menu for one chip. */
function openAttachmentMenu(chip, clientX, clientY) {
  cancelAttachmentAction()
  state.attachmentMenu = {
    target: { ...chip },
    x: Math.max(8, Math.min(clientX, window.innerWidth - 220)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - 190)),
  }
  render()
}

function closeAttachmentMenu() {
  if (state.attachmentMenu === null) return
  state.attachmentMenu = null
  render()
}

/** Copy text, falling back to a hidden textarea when the clipboard API is denied. */
async function copyAttachmentText(text, chip, label) {
  const revision = attachmentRevision
  try {
    await navigator.clipboard.writeText(text)
    if (revision !== attachmentRevision || !mapInteractive) return
    showAttachmentNotice(chip.cardId, chip.key, `已复制${label}`, 'opened')
  } catch {
    if (revision !== attachmentRevision || !mapInteractive) return
    const previousFocus = document.activeElement
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false } finally {
      field.remove()
      if (previousFocus?.isConnected !== false) previousFocus?.focus({ preventScroll: true })
    }
    showAttachmentNotice(chip.cardId, chip.key, ok ? `已复制${label}` : '复制失败，请手动选中', ok ? 'opened' : 'failed')
  }
}

/**
 * Resolve an attachment path to an absolute one.
 *
 * The `present` tool records exactly what the model passed, which can be
 * relative to the session workspace root ("outputs/report.xlsx"). Every consumer
 * — display, copy, reveal — needs the absolute form, so the resolution happens
 * once here instead of at each call site.
 */
function absoluteAttachmentPath(path, context = state.attachmentMenu?.target ?? state.attachmentPreview ?? state.selectedAttachment) {
  const value = typeof path === 'string' ? path.trim() : ''
  if (value === '') return ''
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')) return value
  const owner = (state.allProjections ?? []).find(workspace=>workspace.threads?.some(thread=>thread.dshSessionId === context?.sessionId))
  const root = typeof owner?.cwd === 'string' ? owner.cwd : typeof state.workspace?.cwd === 'string' ? state.workspace.cwd : ''
  if (root === '') return value
  const separator = root.includes('\\') ? '\\' : '/'
  const relative = value.replace(/^[\\/]+/, '').split(/[\\/]/).join(separator)
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative}`
}

/**
 * The directory the host route should open for one attachment path.
 *
 * DSH's `/open-in-app/open` route refuses anything that is not an existing
 * directory, so a file path must be reduced to its containing folder first —
 * and a relative path must be resolved before that reduction can be correct.
 * Kept as its own function so the real behaviour is testable.
 *
 * @returns an absolute directory path, or '' when the attachment has no path.
 */
function attachmentRevealDirectory(path) {
  const absolute = absoluteAttachmentPath(path)
  return absolute === '' ? '' : parentDirectoryOf(absolute)
}

/** The containing directory of an absolute path, without touching the filesystem. */
function parentDirectoryOf(path) {
  const trimmed = String(path).replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (index < 0) return trimmed
  if (index === 0) return '/'
  const head = trimmed.slice(0, index)
  // A path directly under a drive root leaves just "C:", which is not a
  // directory; the containing folder is the root itself.
  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head
}

/**
 * Reveal a file by asking DSH's own open-in-app route to open its directory.
 *
 * This is a plain same-origin HTTP route served by the DSH web server
 * (`@deepseek-ai/dsh-host-open-in-app`), so it needs neither the session Remote
 * nor the host page. The route only accepts directories, which is exactly what
 * "open the containing folder" wants.
 *
 * @returns a human-readable outcome for the chip notice.
 */
async function revealThroughHostRoute(directory, signal) {
  let response
  try {
    response = await fetch('/open-in-app/open', {
      signal,
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'explorer', path: directory }),
    })
  } catch (error) {
    return { ok: false, text: `无法连接 DSH 打开路由：${error instanceof Error ? error.message : String(error)}` }
  }
  if (response.ok) return { ok: true, text: '已打开所在文件夹' }
  const body = await response.json().catch(() => ({}))
  const detail = typeof body?.message === 'string' && body.message !== '' ? body.message : `HTTP ${response.status}`
  const code = typeof body?.code === 'string' && body.code !== '' ? `${body.code}：` : ''
  return { ok: false, text: `打开所在文件夹失败（${code}${detail}）` }
}

/**
 * Ask the host page to open or reveal the recorded file.
 *
 * The Remote call behind this has been observed to never settle, so every
 * request is bounded: past the deadline the pending state is dropped and the
 * user is told, instead of watching a spinner that never ends.
 */
function requestAttachmentAction(reveal) {
  const chip = attachmentActionTarget()
  if (chip === null) return
  cancelAttachmentAction()
  const revision = attachmentRevision
  state.attachmentMenu = null
  if (!reveal) return showAttachmentNotice(chip.cardId, chip.key, '当前宿主的默认应用打开通道不可用，请打开所在文件夹', 'failed')
  const item = findAttachmentByKey(chip.key, chip)
  if (safeAttachmentLink(item?.link ?? chip.path)) return
  const directory = attachmentRevealDirectory(chip.path)
  if (directory === '') return showAttachmentNotice(chip.cardId, chip.key, '此上传附件没有本地路径，请在 DSH 原消息中查看', 'failed')
  const controller = new AbortController()
  attachmentController = controller
  attachmentActionPending = { key: chip.key, cardId: chip.cardId, revision }
  showAttachmentNotice(chip.cardId, chip.key, '正在打开所在文件夹…', 'opening')
  attachmentActionTimer = window.setTimeout(() => {
    if (revision !== attachmentRevision) return
    controller.abort()
    attachmentRevision++
    attachmentActionPending = null
    attachmentController = null
    showAttachmentNotice(chip.cardId, chip.key, '打开请求超时，请重试', 'failed')
  }, ATTACHMENT_ACTION_TIMEOUT_MS)
  revealThroughHostRoute(directory, controller.signal).then(({ ok, text }) => {
    if (revision !== attachmentRevision || !mapInteractive) return
    window.clearTimeout(attachmentActionTimer)
    attachmentController = null
    attachmentActionPending = null
    showAttachmentNotice(chip.cardId, chip.key, text, ok ? 'opened' : 'failed')
  })
}

function safeAttachmentLink(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return ''
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

/** Left-hand preview panel for the selected attachment. */
function attachmentPreviewPanel() {
  const chip = state.attachmentPreview
  if (state.leftPanel !== 'attachment' || chip === null) return ''
  const item = findAttachmentByKey(chip.key, chip)
  const rawPath = item?.path ?? chip.path ?? ''
  const link = safeAttachmentLink(item?.link ?? rawPath)
  const path = link || absoluteAttachmentPath(rawPath)
  const hasPath = item !== null && path !== '' && link === ''
  const notice = state.attachmentNotice?.cardId === chip.cardId && state.attachmentNotice?.key === chip.key ? state.attachmentNotice : null
  const previewStatus = item === null ? '附件已不在当前会话中，请重新选择。' : link ? '链接可在新标签页打开。' : hasPath ? '点击“预览”查看支持的文本或图片；其他类型可打开所在文件夹。' : '此附件按内容 ID 保存，暂不支持内容预览；请在 DSH 原消息中查看。'
  const origin = item?.sourceType === 'deliverable' ? '交付物' : item?.sourceType === 'image' ? '上传图片' : item?.sourceType === 'file' ? '上传文件' : '附件'
  const meta = [origin, item?.kindLabel, item?.sizeLabel].filter((part) => typeof part === 'string' && part !== '')
  const field = (label, value) => (typeof value === 'string' && value !== '' ? `<div class="attachment-preview-field"><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></div>` : '')
  // The 64-hex content id only earns its space when it is the sole identifier —
  // an upload with no recorded file path. With a path it is noise.
  const rows = [field(link ? '链接' : '完整路径', path), hasPath ? '' : field('附件 ID', item?.id ?? '')].join('')
  const position = Number.isInteger(chip.seq) ? `消息 #${chip.seq}` : ''
  return `<aside data-map-panel data-panel-side="left" data-panel-kind="attachment" class="attachment-preview map-panel map-panel-left${state.attachmentPreviewOpening ? ' is-opening' : ''}" aria-label="附件信息" aria-busy="${notice?.tone === 'opening'}"><header class="attachment-preview-head"><div><div class="attachment-preview-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}${position === '' ? '' : `<span>${escapeHtml(position)}</span>`}</div><button class="attachment-preview-target" type="button" data-action="attachment-reveal" ${hasPath ? '' : 'disabled'} title="${hasPath ? '打开所在文件夹' : '这个附件没有可打开的文件路径'}"><span class="attachment-icon attachment-icon-${escapeHtml(item?.kind ?? 'unknown')}" aria-hidden="true"></span><span class="attachment-preview-name">${escapeHtml(chip.name ?? '附件')}</span></button></div><button class="attachment-preview-close" type="button" data-action="close-attachment-preview" aria-label="关闭附件预览" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></header><div class="attachment-preview-scroll">${item?.title ? `<p class="attachment-preview-desc">${escapeHtml(item.title)}</p>` : ''}${rows}<p class="attachment-preview-empty">${escapeHtml(previewStatus)}</p>${notice === null ? '' : `<p class="attachment-preview-feedback" role="status">${escapeHtml(notice.text)}</p>`}</div><footer class="attachment-preview-actions"><button type="button" class="primary" data-action="preview-content">预览</button><button type="button" class="primary" data-action="attachment-reveal" ${hasPath ? '' : 'disabled'}>打开所在文件夹</button><button type="button" data-action="attachment-copy-path" ${hasPath ? '' : 'disabled'}>复制路径</button><button type="button" data-action="attachment-copy-folder" ${hasPath ? '' : 'disabled'}>复制文件夹</button>${link ? `<a class="attachment-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">在新标签页打开</a>` : ''}${chip.sessionId && Number.isInteger(chip.seq) ? '<button type="button" data-action="attachment-locate">在 DSH 中查看原消息</button>' : ''}</footer></aside>`
}

/** Right-click menu, positioned at the pointer. */
function attachmentContextMenu() {
  const menu = state.attachmentMenu
  if (menu === null) return ''
  const hasPath = typeof menu.target.path === 'string' && menu.target.path !== '' && !safeAttachmentLink(menu.target.path)
  const entry = (action, label, enabled = true) => `<button type="button" role="menuitem" data-action="${action}" ${enabled ? '' : 'disabled'}>${escapeHtml(label)}</button>`
  return `<div class="attachment-menu" role="menu" style="left:${menu.x}px;top:${menu.y}px">${entry('attachment-reveal', '打开所在文件夹', hasPath)}${entry('attachment-copy-path', '复制完整路径', hasPath)}${entry('attachment-copy-folder', '复制所在文件夹', hasPath)}${entry('attachment-copy-name', '复制文件名')}${entry('attachment-locate', '在 DSH 中定位原消息', Number.isInteger(menu.target.seq) && typeof menu.target.sessionId === 'string' && menu.target.sessionId !== '')}</div>`
}

/**
 * Transient, per-chip feedback for an open attempt. Opening runs in the host
 * page, so the result always arrives asynchronously; without this the click
 * would look like it did nothing — which is exactly what it used to do.
 */
function showAttachmentNotice(cardId, key, text, tone) {
  state.attachmentNotice = { cardId, key, text, tone }
  window.clearTimeout(attachmentNoticeTimer)
  if (tone !== 'opening') {
    attachmentNoticeTimer = window.setTimeout(() => { state.attachmentNotice = null; render() }, 4000)
  }
  render()
}

/**
 * The bottom row of attachments on one turn card.
 *
 * Every chip is a real button: it is focusable, it has a hover state, and
 * clicking it asks the host page to open the recorded file through DSH's own
 * `session.openWorkspacePath`. An attachment with no file path (an upload,
 * which DSH stores by content id) cannot be opened that way, so it says so
 * instead of silently doing nothing.
 */
function attachmentStrip(attachments, cardId, sessionId) {
  if (!Array.isArray(attachments) || attachments.length === 0) return ''
  const expanded = state.expandedAttachmentCards.has(cardId)
  const visible = expanded ? attachments : attachments.slice(0, ATTACHMENT_VISIBLE_LIMIT)
  const hidden = attachments.length - visible.length
  const notice = state.attachmentNotice?.cardId === cardId ? state.attachmentNotice : null
  const chips = visible.map(item => {
    const openable = typeof item.path === 'string' && item.path !== ''
    const tone = notice !== null && notice.key === item.key ? ` is-${notice.tone}` : ''
    return `<button type="button" class="attachment-chip${tone}" data-action="open-attachment" data-card="${escapeHtml(cardId)}" data-key="${escapeHtml(item.key)}" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path ?? '')}" data-session="${escapeHtml(sessionId ?? '')}" data-seq="${Number.isInteger(item.messageSeq) ? item.messageSeq : ''}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(`${openable ? '打开' : '查看'}附件 ${item.name}`)}"><span class="attachment-icon attachment-icon-${escapeHtml(item.kind)}" aria-hidden="true"></span><span class="attachment-name">${escapeHtml(item.name)}</span><span class="attachment-meta">${escapeHtml(item.metaLabel)}</span></button>`
  }).join('')
  const toggle = expanded
    ? `<button class="attachment-toggle" type="button" data-action="toggle-attachments" data-card="${escapeHtml(cardId)}" aria-expanded="true" title="收起附件">收起</button>`
    : hidden > 0
      ? `<button class="attachment-toggle" type="button" data-action="toggle-attachments" data-card="${escapeHtml(cardId)}" aria-expanded="false" title="展开全部 ${attachments.length} 个附件">+${hidden}</button>`
      : ''
  const line = notice === null ? '' : `<span class="attachment-notice is-${notice.tone}" role="status">${escapeHtml(notice.text)}</span>`
  return `<div class="thread-attachments${expanded ? ' expanded' : ''}${notice === null ? '' : ' has-notice'}" aria-label="附件 ${attachments.length} 个">${chips}${toggle}${line}</div>`
}

/**
 * Attachments belonging to one turn card: the question's own, plus every
 * reply's. Deliverables already sit on their own turn's assistant message, so
 * they arrive through the same field. Deduplicated by `key` because the same
 * file can legitimately appear in more than one message of a turn.
 */
function turnAttachments(question, replies, errors) {
  const collected = []
  const seen = new Set()
  const sources = [question, ...(Array.isArray(replies) ? replies : []), ...(Array.isArray(errors) ? errors : [])]
  for (const message of sources) {
    for (const list of [message?.attachments, message?.deliverables]) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item === null || typeof item !== 'object' || typeof item.key !== 'string' || seen.has(item.key)) continue
        seen.add(item.key)
        collected.push(item)
      }
    }
  }
  return collected
}

function conversationCard(card, graph) {
  const selected = card.id === state.selectedCardId ? 'selected' : ''
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const continueButton = card.canContinue === true
    ? `<button class="graph-continue-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" aria-label="添加追问" title="添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  const childCount = graph.childCounts.get(card.id) ?? 0
  const collapsed = state.collapsedCardIds.has(card.id)
  const foldLabel = collapsed ? '展开后续对话' : '折叠后续对话'
  const foldButton = childCount === 0 || card.canContinue === true ? '' : `<button class="graph-fold-button${collapsed ? ' collapsed' : ''}" data-action="toggle-card-children" data-card="${escapeHtml(card.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${foldLabel}" title="${foldLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8h9"/>${collapsed ? '<path d="M8 3.5v9"/>' : ''}</svg></button>`
  const branchButton = childCount === 0 || card.canContinue === true || !Number.isInteger(card.answer?.sourceSeq) ? '' : `<button class="graph-branch-button" data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}" aria-label="在新对话中分支" title="在新对话中分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"/></svg></button>`
  return `<article class="thread-card ${selected}${locatedCardId === card.id && Date.now() < locatedUntil ? ' is-locate-target' : ''}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    ${continueButton}${foldButton}${branchButton}
    <div class="thread-card-head"><span class="topic-dot"></span><button class="thread-title" data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话：${escapeHtml(card.question)}">${escapeHtml(card.question)}</button></div>
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-error-status">失败</span>'}${card.processCount > 0 ? `<span class="card-process-count">工具 ${card.processCount}</span>` : ''}</div>
    <div class="thread-answer">${card.answer === null ? (card.error === null ? '<p class="thread-answer-empty">等待助手回复</p>' : '') : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}${card.error === null ? '' : `<p class="thread-answer-error" title="${escapeHtml(card.error.text)}">本轮失败：${escapeHtml(card.error.text)}</p>`}</div>
    ${attachmentStrip(card.attachments, card.id, card.dshSessionId)}
    <footer><button data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话" aria-label="查看完整会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 8.5 8 2.5l6 6V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z"/><path d="M6.2 14v-3.6a1.8 1.8 0 0 1 3.6 0V14" /></svg>详情</button><button data-action="open-dsh" data-thread="${card.dshThreadId}" data-seq="${Number.isInteger(card.sourceSeq) ? card.sourceSeq : ''}" title="在 DSH 中打开" aria-label="在 DSH 中打开"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>DSH</button><button data-action="archive-thread" data-thread="${card.dshThreadId}" title="归档此会话" aria-label="归档此会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5h11M5.5 7v5.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V7"/><path d="M4 5 5 2.8a.7.7 0 0 1 .6-.4h4.8a.7.7 0 0 1 .6.4L12 5M6 9.5h4"/></svg>归档</button></footer>
  </article>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

function quickPhraseEditor(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const phrases = state.quickPhrases.map((phrase, index) => `<div class="draft-quick-phrase-editor-row"><input data-quick-phrase-index="${index}" maxlength="${MAX_QUICK_PHRASE_LENGTH}" value="${escapeHtml(phrase)}" aria-label="快捷词 ${index + 1}" ${disabled}><button type="button" data-action="remove-quick-phrase" data-quick-phrase-index="${index}" aria-label="删除 ${escapeHtml(phrase)}" title="删除" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>`).join('')
  return `<section class="draft-quick-editor" aria-label="编辑快捷词"><div class="draft-quick-editor-list">${phrases}</div><div class="draft-quick-phrase-add"><input maxlength="${MAX_QUICK_PHRASE_LENGTH}" placeholder="添加快捷词" aria-label="添加快捷词" ${disabled}><button class="primary" type="button" data-action="add-quick-phrase" aria-label="添加快捷词" title="添加快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div><button class="draft-quick-editor-close" type="button" data-action="close-quick-phrase-editor" ${disabled}>完成</button></section>`
}

function draftQuickPhrases(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  if (state.quickPhraseEditorOpen) return quickPhraseEditor(draft)
  const phrases = state.quickPhrases.map(phrase => `<button class="draft-quick-phrase" type="button" data-action="insert-quick-phrase" data-quick-phrase="${escapeHtml(phrase)}" ${disabled}>${escapeHtml(phrase)}</button>`).join('')
  return `<div class="draft-quick-phrases" aria-label="常用补充词">${phrases}<button class="draft-quick-phrase-add-button" type="button" data-action="open-quick-phrase-editor" aria-label="管理快捷词" title="管理快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>`
}

function insertQuickPhrase(phrase) {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement) || state.draft === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const prefix = input.value.slice(0, start)
  const suffix = input.value.slice(end)
  const separator = prefix !== '' && !prefix.endsWith('\n') ? '\n' : ''
  const text = `${prefix}${separator}${phrase}${suffix}`
  if (text.length > input.maxLength) return setError('追问内容不能超过 4000 个字符')
  const caret = prefix.length + separator.length + phrase.length
  input.value = text
  state.draft.text = text
  input.focus()
  input.setSelectionRange(caret, caret)
}

function addQuickPhrase(value) {
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') return false
  if (state.quickPhrases.includes(phrase)) return setError('这个快捷词已经存在')
  if (state.quickPhrases.length >= MAX_QUICK_PHRASES) return setError(`最多保留 ${MAX_QUICK_PHRASES} 个快捷词`)
  state.quickPhrases.push(phrase)
  persistQuickPhrases()
  return true
}

function updateQuickPhrase(index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= state.quickPhrases.length) return
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') {
    state.quickPhrases.splice(index, 1)
  } else if (state.quickPhrases.some((item, itemIndex) => itemIndex !== index && item === phrase)) {
    return setError('这个快捷词已经存在')
  } else {
    state.quickPhrases[index] = phrase
  }
  persistQuickPhrases()
  render()
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = draft.anchorId === undefined
    ? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
    : cards.find(card => card.id === draft.anchorId)
  if (parent === undefined) return null
  return { parent, position: firstAvailableCardPosition({ x: parent.position.x + 365, y: parent.position.y }, cards.map(card => card.position)) }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft>${draftQuickPhrases(draft)}<textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

function selectionFollowupButton() {
  return `<button class="selection-followup" type="button" data-action="follow-selection" hidden aria-label="基于所选内容创建追问" title="基于所选内容追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h10v6.25H7.2L4 12.5V9.75H3Z"/><path d="M8 4.9v3.4M6.3 6.6h3.4"/></svg><span>追问</span></button>`
}

// Cards are mounted into the DOM only when they intersect the viewport
// (inflated by VIEWPORT_MARGIN) in world coordinates. The camera transform is
// translate(camera) scale(zoom), so screen = world * zoom + camera.
function visibleCardIds(cards) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return new Set(cards.map(card => card.id))
  const bounds = viewport.getBoundingClientRect()
  const left = (-state.canvasCamera.x - VIEWPORT_MARGIN) / state.zoom
  const right = (bounds.width - state.canvasCamera.x + VIEWPORT_MARGIN) / state.zoom
  const top = (-state.canvasCamera.y - VIEWPORT_MARGIN) / state.zoom
  const bottom = (bounds.height - state.canvasCamera.y + VIEWPORT_MARGIN) / state.zoom
  const visible = new Set()
  for (const card of cards) {
    const { x, y } = card.position
    if (x + CARD_WIDTH < left || x > right || y + CARD_HEIGHT < top || y > bottom) continue
    visible.add(card.id)
  }
  return visible
}

// Incrementally mount cards entering the viewport and unmount cards leaving
// it, without rebuilding the canvas. Called after pan/zoom/focus camera moves.
function syncCanvasViewport() {
  if (state.mode !== 'canvas' || state.canvasCards === undefined) return
  const layer = document.querySelector('.cards-layer')
  if (!(layer instanceof HTMLElement)) return
  const visible = visibleCardIds(state.canvasCards)
  for (const cardId of [...state.mountedCardIds]) {
    if (visible.has(cardId)) continue
    const element = layer.querySelector(`[data-card-id="${selectorValue(cardId)}"]`)
    if (element instanceof HTMLElement) element.remove()
    state.mountedCardIds.delete(cardId)
  }
  for (const card of state.canvasCards) {
    if (!visible.has(card.id) || state.mountedCardIds.has(card.id)) continue
    const wrapper = document.createElement('div')
    wrapper.innerHTML = conversationCard(card, state.canvasGraph)
    const element = wrapper.firstElementChild
    if (element instanceof HTMLElement) {
      layer.appendChild(element)
      const handle = element.querySelector('[data-drag-card]')
      if (handle instanceof HTMLElement) bindDragHandle(handle)
    }
    state.mountedCardIds.add(card.id)
  }
  rgbSequence.sync()
  restoreLocateHighlight()
}

function renderCanvas() {
  const threads = state.workspace?.threads ?? []
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas"><strong>当前工作目录还没有 DSH 对话。</strong><p>点击新会话，在画布中输入第一条消息。</p><div><button class="primary" type="button" data-action="create-session">新建会话</button></div></section>`
  const allCards = conversationCards(threads, {layout:state.browserMode !== 'session'})
  const laidOut = state.browserMode === 'session' ? sessionLayout(allCards, threads).cards : allCards
  const graph = conversationGraphView(laidOut)
  const cards = graph.cards
  state.canvasCards = cards
  state.canvasCardsById = new Map(cards.map(card => [card.id, card]))
  state.canvasGraph = graph
  if (state.inspectorCardId !== null && !state.canvasCardsById.has(state.inspectorCardId)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
  }
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
    // The viewport is not laid out yet while renderCanvas builds its HTML;
    // center the focused card once the DOM is mounted (render tail).
    state.canvasNeedsCenter = true
  }
  const visible = visibleCardIds(cards)
  state.mountedCardIds = new Set(visible)
  const mounted = cards.filter(card => visible.has(card.id))
  const inspector = state.inspectorCardId === null ? '' : renderCardInspector(state.canvasCardsById.get(state.inspectorCardId))
  return `<section class="canvas-view"><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${canvasConnectors(cards)}</svg><div class="cards-layer">${mounted.map(card => conversationCard(card, graph)).join('')}${draftCard(cards)}</div></div></div>${inspector}<div class="map-left-slot">${leftPanelMarkup()}</div><div class="map-right-slot">${previewController.renderPreview(escapeHtml)}</div>${attachmentContextMenu()}</section>`
}

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
}

function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const label = isUser ? '你' : message.kind === 'assistant' ? 'DSH' : message.kind === 'error' ? '错误' : '记录'
  const branch = message.kind === 'assistant' && Number.isInteger(message.sourceSeq)
    ? `<button class="message-branch" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button>`
    : ''
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const fold = collapsible ? `<button class="message-fold" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></button>` : ''
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const body = message.pending && message.text === '' ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${collapsible && !expanded ? `<p class="message-summary">${escapeHtml(processSummary(message.text))}</p>` : renderMarkdown(message.text)}${message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''}${process === null ? '' : processRecords(process, messageId)}`
  const avatar = isUser ? '' : '<span class="message-avatar" aria-hidden="true"></span>'
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}${collapsible ? ' message-collapsible' : ''}${expanded ? ' expanded' : ''}" data-message-seq="${Number.isInteger(message.sourceSeq) ? message.sourceSeq : ''}"><header>${avatar}<span class="message-role">${label}</span><time>${formatTime(message.at)}</time>${branch}${fold}</header><div class="message-body">${body}</div></article>`
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  const entries = process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
    const argumentsHtml = entry.arguments === null || entry.arguments === '' ? '' : `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
    const outcomeHtml = entry.error !== null ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>` : entry.result === null ? '' : `<pre class="process-result">${escapeHtml(entry.result)}</pre>`
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${entry.error !== null ? ' process-status-error' : entry.result === null ? ' process-status-pending' : ' process-status-done'}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? entries : ''}</section>`
}

function messagesForCard(card) {
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  if (thread === undefined) return { thread: null, messages: [] }
  const messages = messagesFor(thread)
  let turnIndex = -1
  let start = -1
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].kind !== 'user') continue
    turnIndex += 1
    if (turnIndex === card.turnIndex) {
      start = index
      break
    }
  }
  if (start === -1) return { thread, messages: [] }
  const end = messages.findIndex((message, index) => index > start && message.kind === 'user')
  return { thread, messages: messages.slice(start, end === -1 ? undefined : end) }
}

function inspectorProcessEntries(messages) {
  const entries = []
  for (const message of messages) {
    if (Array.isArray(message.process)) {
      entries.push(...message.process.map(entry => ({ ...entry })))
      continue
    }
    if (message.kind === 'tool') {
      entries.push({ name: processSummary(message.text), arguments: message.text, result: null, error: null })
      continue
    }
    if (message.kind === 'tool-result') {
      const previous = entries.at(-1)
      if (previous !== undefined && previous.result === null && previous.error === null) previous.result = message.text
      else entries.push({ name: '工具结果', arguments: null, result: message.text, error: null })
    }
  }
  return entries
}

function renderCardInspector(card) {
  if (card === undefined) return ''
  const { thread, messages } = messagesForCard(card)
  if (thread === null) return ''
  const process = inspectorProcessEntries(messages)
  const answer = card.answer === null
    ? card.error === null ? '<p class="card-inspector-pending">等待助手回复</p>' : ''
    : `<article class="card-inspector-answer">${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = card.error === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(card.error.text)}</p></section>`
  const processRecordsHtml = process.length === 0 ? '' : processRecords(process, `${thread.id}:${card.id}:inspector`)
  const continueAction = card.canContinue === true ? `<button type="button" data-action="open-continue" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3.5 2.5v-2.5h-1.5Z"/><path d="M8 5.5v3M6.5 7h3"/></svg>继续追问</button>` : ''
  const branch = Number.isInteger(card.answer?.sourceSeq)
    ? `<button type="button" data-action="open-branch" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M5.5 3.5h2A2.5 2.5 0 0 1 10 6v5"/></svg>创建分支</button>`
    : ''
  const openDshAction = `<button class="primary" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(card.answer?.sourceSeq) ? card.answer.sourceSeq : ''}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>在 DSH 中打开</button>`
  return `<aside class="card-inspector${state.inspectorOpening ? ' is-opening' : ''}" aria-label="卡片详情" data-inspector-card="${escapeHtml(card.id)}"><header class="card-inspector-head"><div><div class="card-inspector-meta"><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-inspector-error-status">失败</span>'}${process.length > 0 ? `<span>工具 ${process.length}</span>` : ''}</div><h2>${escapeHtml(card.question)}</h2></div><button class="card-inspector-close" type="button" data-action="close-card-inspector" aria-label="关闭卡片详情" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></header><div class="card-inspector-scroll">${error}${answer}${processRecordsHtml}</div><footer class="card-inspector-actions">${continueAction}${branch}${openDshAction}</footer></aside>`
}

function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  const latestAssistantSeq = [...messages].reverse().find(message => Number.isInteger(message.sourceSeq))?.sourceSeq
  return `<section class="detail-view"><header class="detail-head"><div class="detail-head-title"><div class="detail-head-meta"><span class="detail-badge">${thread.parentId === null ? '会话' : '分支'}</span>${thread.dshSessionTitle ?? thread.title ? `<span class="detail-subtitle">${escapeHtml(thread.dshSessionTitle ?? thread.title)}</span>` : ''}</div><h1>${escapeHtml(questionFor(thread))}</h1></div><div class="detail-head-actions"><button data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" title="在原生对话中打开此会话">在 DSH 中打开</button><button data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支">创建分支</button><button class="primary" data-action="show-canvas">返回画布</button></div></header><div class="detail-scroll">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" placeholder="继续当前会话…" ${waiting ? 'disabled' : ''}></textarea><button class="primary" type="submit" ${waiting ? 'disabled' : ''}>${waiting ? '等待回复' : '发送'}</button></form></section>`
}

function render() {
  if (searchController.snapshot().composing) return
  const departingPanels = capturePanels()
  const searchFocused = document.activeElement?.matches?.('[data-search-input]')
  const searchSelection = searchFocused ? [document.activeElement.selectionStart,document.activeElement.selectionEnd] : null
  cancelPanelAnimations()
  const previousAttachmentPanel = document.activeElement?.closest?.('.attachment-preview')
  const attachmentFocusIndex = previousAttachmentPanel ? [...previousAttachmentPanel.querySelectorAll('button, a')].indexOf(document.activeElement) : -1
  const attachmentScrollTop = document.querySelector('.attachment-preview-scroll')?.scrollTop ?? 0
  // Remember the departing thread's scroll position per thread id, so
  // switching sessions restores each conversation's own place instead of
  // smearing one session's position onto another.
  if (state.mode === 'thread' && state.detailThreadId !== null) {
    const detail = document.querySelector('.detail-scroll')
    if (detail instanceof HTMLElement) state.detailScrollByThread.set(state.detailThreadId, detail.scrollTop)
  }
  if (state.mode === 'canvas' && state.inspectorCardId !== null) {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) state.inspectorScrollByCard.set(state.inspectorCardId, inspector.scrollTop)
  }
  state.detailThreadId = state.mode === 'thread' ? state.activeId : null
  const detailScrollTop = state.detailThreadId === null ? null : state.detailScrollByThread.get(state.detailThreadId) ?? null
  const inspectorScrollTop = state.mode === 'canvas' && state.inspectorCardId !== null ? state.inspectorScrollByCard.get(state.inspectorCardId) ?? null : null
  const cardScrollTops = new Map()
  if (state.mode === 'canvas') {
    // Key by the unique card id: every card of a session shares data-thread,
    // so keying on it would clobber sibling cards' scroll positions. Only
    // scrollable answers have a position worth preserving; reading the two
    // height properties shares the same forced layout as the scrollTop read.
    for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
      if (answer.scrollHeight <= answer.clientHeight) continue
      const card = answer.closest('.thread-card')
      if (card instanceof HTMLElement && typeof card.dataset.cardId === 'string') cardScrollTops.set(card.dataset.cardId, answer.scrollTop)
    }
  }
  const workspace = state.workspace
  const threads = workspace?.threads ?? []
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const choices = workspaceChoices()
  const selectedWorkspaceId = state.selectedDshWorkspaceId ?? workspace?.id
  const canvasControls = state.mode === 'canvas' && (threads.length > 0 || state.draft?.kind === 'new') ? `<div class="canvas-controls">${state.browserMode === 'session' ? '<button data-action="return-global" class="primary">返回全局</button>' : ''}<button data-action="fit-view">适配</button><button data-action="open-search" title="搜索全部会话 Ctrl+F">搜索</button><button data-action="layout" title="整理节点" aria-label="整理节点"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>整理</button><button data-action="focus-active" title="定位到当前会话" aria-label="定位到当前会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg>定位</button><button data-action="zoom-out" aria-label="缩小" title="缩小"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg></button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大" title="放大"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>` : ''
  const detailAvailable = currentThread() !== null
  const canvasTabs = `<nav class="canvas-tabs" aria-label="会话地图视图"><button class="${state.mode === 'canvas' ? 'active' : ''}" data-action="show-canvas">地图</button><button class="${state.mode === 'thread' ? 'active' : ''}" data-action="show-thread" data-thread="${state.activeId ?? ''}" ${detailAvailable ? '' : 'disabled'}>详情</button></nav>`
  app.innerHTML = `<main class="synapse-shell ${state.browserMode === 'session' ? 'session-mode' : ''} ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row"><div class="brand" aria-label="yuki's map EA先行版"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>yuki's map EA先行版</strong></div><button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><label class="workspace-label"><span>工作区</span><span class="workspace-select"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.75h3l1.2 1.5h6.8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg><select data-action="select-workspace" aria-label="选择工作区" ${state.draft !== null ? 'disabled' : ''}>${choices.map(item => `<option value="${item.id}" title="${escapeHtml(item.path ?? item.title)}" ${item.id === selectedWorkspaceId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></span></label><div class="sidebar-heading"><span>会话</span></div><nav class="thread-tree">${threads.map(thread => `<button class="tree-row ${thread.id === state.activeId ? 'active' : ''}" data-action="select-thread" data-thread="${thread.id}" style="--thread-color:#374151"><span class="tree-dot"></span><span>${escapeHtml(threadListTitle(thread))}</span>${thread.parentId === null ? '' : '<i>分支</i>'}</button>`).join('') || '<p class="tree-empty">暂未同步会话</p>'}</nav></aside><header class="topbar">${canvasControls}</header><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}<div class="map-search-slot"></div>${view}${selectionFollowupButton()}<span class="navigation-status" role="status" aria-live="polite"></span></section></main>`
  mountFeaturePanels()
  animateClosingPanels(departingPanels)
  if (searchSelection) {searchController.focus();document.querySelector('[data-search-input]')?.setSelectionRange(...searchSelection)}
  rgbSequence.sync()
  installDragging()
  cacheCardConnectors()
  observeCanvasLayout()
  restoreLocateHighlight()
  const attachmentScroll = document.querySelector('.attachment-preview-scroll')
  if (attachmentScroll instanceof HTMLElement) attachmentScroll.scrollTop = attachmentScrollTop
  if (attachmentFocusIndex >= 0) document.querySelectorAll('.attachment-preview button, .attachment-preview a')[attachmentFocusIndex]?.focus({ preventScroll: true })
  // The initial camera from renderCanvas is inset (viewport not laid out yet);
  // center it on the focused card once the canvas DOM is mounted.
  if (state.canvasNeedsCenter) {
    state.canvasNeedsCenter = false
    window.requestAnimationFrame(() => { if (mapInteractive && state.mode === 'canvas' && locateFrame === 0) focusActiveCard() })
  }
  for (const [cardId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-card-id="${CSS.escape(cardId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
  if (inspectorScrollTop !== null) window.requestAnimationFrame(() => {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) inspector.scrollTop = inspectorScrollTop
  })
  if (state.attachmentPreviewOpening) window.requestAnimationFrame(() => {
    state.attachmentPreviewOpening = false
    document.querySelector('.attachment-preview')?.classList.remove('is-opening')
  })
  if (state.inspectorOpening) window.requestAnimationFrame(() => {
    document.querySelector('.card-inspector')?.classList.remove('is-opening')
    state.inspectorOpening = false
  })
  // Jump the detail view to the card the user clicked: card ids carry the
  // source sequence (`<thread>:turn:<seq>`), which matches data-message-seq
  // anchors on the rendered messages.
  const targetCardId = state.detailTargetCardId
  state.detailTargetCardId = null
  if (targetCardId !== null) {
    const match = /:turn:(\d+)$/.exec(targetCardId)
    const seq = match === null ? null : match[1]
    if (seq !== null) window.requestAnimationFrame(() => {
      const target = app.querySelector(`[data-message-seq="${CSS.escape(seq)}"]`)
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' })
    })
  }
}

function renderPreservingDetailScroll() {
  render()
}

let inspectorCloseTimer = 0
function openCardInspector(cardId) {
  previewController.closePreview()
  searchController.closeFlyout()
  if (inspectorCloseTimer !== 0) {
    window.clearTimeout(inspectorCloseTimer)
    inspectorCloseTimer = 0
  }
  closeAttachmentPreview({ animate: false, restoreFocus: false })
  state.inspectorOpening = state.inspectorCardId === null
  state.inspectorCardId = cardId
}

function closeCardInspector({ animate = true } = {}) {
  if (state.inspectorCardId === null) return
  if (inspectorCloseTimer !== 0) window.clearTimeout(inspectorCloseTimer)
  const cardId = state.inspectorCardId
  const inspector = document.querySelector('.card-inspector')
  if (!animate || !(inspector instanceof HTMLElement)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
    return
  }
  inspector.classList.add('is-closing')
  inspectorCloseTimer = window.setTimeout(() => {
    inspectorCloseTimer = 0
    if (state.inspectorCardId !== cardId) return
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
  }, 180)
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}

function bindDragHandle(handle) {
  if (state.browserMode === 'session') return
  handle.addEventListener('pointerdown', event => {
    const cardId = event.currentTarget.dataset.dragCard
    const card = event.currentTarget.closest('.thread-card')
    if (cardId === undefined || !(card instanceof HTMLElement)) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY, position: { x: Number.parseFloat(card.style.left), y: Number.parseFloat(card.style.top) } }
    const aliases = card.dataset.positionKey === undefined ? [] : [card.dataset.positionKey]
    let position = origin.position
    let stopped = false
    let frame = 0
    cancelCardDrag?.()
    state.dragging = true
    // Coalesce pointermove updates to one DOM pass per animation frame so a
    // high report-rate pointer cannot queue a reflow per event.
    const apply = () => {
      frame = 0
      state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
      for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
      // Keep the virtualized data object in sync so viewport visibility and
      // connector paths track the live drag position.
      const dataCard = state.canvasCardsById?.get(cardId)
      if (dataCard !== undefined) dataCard.position = { x: position.x, y: position.y }
      card.style.left = `${position.x}px`
      card.style.top = `${position.y}px`
      refreshCardConnectors(cardId)
    }
    const move = moveEvent => {
      position = { x: origin.position.x + (moveEvent.clientX - origin.x) / state.zoom, y: origin.position.y + (moveEvent.clientY - origin.y) / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      cancelCardDrag = null
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      rememberCardPosition(cardId, position, aliases)
      state.dragging = false
      deferCanvasRefresh(120)
      // No full render: only the dragged card's inline position and its
      // connectors changed; rebuilding the whole canvas on drop is the jank.
    }
    cancelCardDrag = stop
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installDragging() {
  for (const handle of document.querySelectorAll('[data-drag-card]')) bindDragHandle(handle)
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  const zoom = Math.min(4, Math.max(.6, Math.round(nextZoom * 100) / 100))
  if (zoom === state.zoom) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const worldX = (localX - state.canvasCamera.x) / state.zoom
  const worldY = (localY - state.canvasCamera.y) / state.zoom
  state.zoom = zoom
  state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
  const content = viewport.querySelector('.canvas-content')
  if (content instanceof HTMLElement) {
    // Drop the composited layer before zooming: a cached will-change raster
    // would be upscaled instead of re-rasterized, which was the original
    // zoom-blur bug. will-change re-applies via .is-panning on the next pan.
    content.style.willChange = 'auto'
    applyCanvasTransform()
    syncCanvasViewport()
    window.requestAnimationFrame(() => { content.style.willChange = '' })
  } else {
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
}

function zoomCanvasAtCenter(delta) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  zoomCanvas(viewport, state.zoom + delta, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
}

function focusActiveCard() {
  const cards = state.canvasCards
  if (!mapInteractive || cards === undefined || cards.length === 0) return
  const draft = state.draft === null ? undefined : state.draft.kind === 'new' ? { position: { x: 86, y: 82 } } : draftPlacement(cards)
  const card = draft ?? cards.filter(item => item.dshThreadId === state.activeId).at(-1)
  if (card !== undefined) centerCanvasCard(card)
}

let selectionFollowup = null
let selectionFollowupFrame = 0

function hideSelectionFollowup() {
  if (selectionFollowupFrame !== 0) {
    window.cancelAnimationFrame(selectionFollowupFrame)
    selectionFollowupFrame = 0
  }
  selectionFollowup = null
  const button = app.querySelector('.selection-followup')
  if (button instanceof HTMLButtonElement) button.hidden = true
}

function selectionFollowupTarget(range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!(start instanceof Element) || !(end instanceof Element)) return null
  const answer = start.closest('.thread-answer')
  if (answer instanceof HTMLElement && answer.contains(end)) {
    const card = answer.closest('.thread-card[data-thread]:not(.draft-card)')
    if (card instanceof HTMLElement && card.dataset.thread !== undefined) return { threadId: card.dataset.thread }
  }
  const messageBody = start.closest('.message-assistant .message-body')
  const thread = currentThread()
  if (messageBody instanceof HTMLElement && messageBody.contains(end) && thread !== null) return { threadId: thread.id }
  return null
}

function updateSelectionFollowup() {
  selectionFollowupFrame = 0
  const button = app.querySelector('.selection-followup')
  const selection = window.getSelection()
  if (!(button instanceof HTMLButtonElement) || state.draft !== null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return hideSelectionFollowup()
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const target = text === '' || text.length > 4000 ? null : selectionFollowupTarget(range)
  const rect = range.getBoundingClientRect()
  if (target === null || rect.width === 0 || rect.height === 0) return hideSelectionFollowup()
  selectionFollowup = { ...target, text }
  button.dataset.thread = target.threadId
  button.style.left = `${Math.min(window.innerWidth - 12, Math.max(76, rect.right))}px`
  button.style.top = `${Math.min(window.innerHeight - 38, Math.max(8, rect.bottom + 8))}px`
  button.hidden = false
}

function queueSelectionFollowup() {
  if (selectionFollowupFrame !== 0) return
  selectionFollowupFrame = window.requestAnimationFrame(updateSelectionFollowup)
}

let cancelCanvasGesture = null
let cancelCardDrag = null
app.addEventListener('pointerdown', event => {
  if (!mapInteractive || event.button !== 0) return
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select')) return
  event.preventDefault()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  let moved = false
  let pendingCamera = null
  let frame = 0
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const apply = () => {
    frame = 0
    if (pendingCamera === null) return
    state.canvasCamera = pendingCamera
    pendingCamera = null
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const move = moveEvent => {
    if (Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > 5) moved = true
    if (!moved) return
    pendingCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = stopEvent => {
    cancelCanvasGesture = null
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    state.canvasGesture = false
    deferCanvasRefresh(120)
    if (!moved && stopEvent?.type === 'pointerup') closeMapPanels()
  }
  cancelCanvasGesture = () => stop(null)
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

app.addEventListener('wheel', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  const card = event.target instanceof Element ? event.target.closest('.thread-card') : null
  if (card instanceof HTMLElement) {
    // Over a card the wheel scrolls that card's own answer with the browser's
    // native wheel (OS-smooth, never a page jump per notch); the answer's
    // overscroll-behavior: contain stops the scroll chaining into the canvas.
    const answer = card.querySelector('.thread-answer')
    if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight) {
      deferCanvasRefresh()
      return
    }
    // A card with no scrollable answer swallows the wheel instead of zooming.
    event.preventDefault()
    deferCanvasRefresh()
    return
  }
  event.preventDefault()
  zoomCanvas(viewport, state.zoom + (event.deltaY < 0 ? .05 : -.05), event.clientX, event.clientY)
}, { passive: false })

// Track pointer-down so the card click handler can tell a plain click from a
// text-selection or drag gesture; acting on the latter would re-render and
// wipe the user's selection.
let pointerDownPosition = null
app.addEventListener('pointerdown', event => { pointerDownPosition = { x: event.clientX, y: event.clientY } })
app.addEventListener('pointerdown', event => {
  const button = event.target instanceof Element ? event.target.closest('.selection-followup') : null
  if (button instanceof HTMLButtonElement) event.preventDefault()
  else hideSelectionFollowup()
})
app.addEventListener('pointerup', queueSelectionFollowup)
app.addEventListener('scroll', hideSelectionFollowup, true)
document.addEventListener('selectionchange', queueSelectionFollowup)
document.addEventListener('keydown', event => {
  if (!mapInteractive || event.isComposing || event.keyCode === 229 || searchController.snapshot().composing) return
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); openMapSearch(); return }
  if (event.key === 'Escape' && handleFeatureEscape()) { event.preventDefault(); return }
  if (event.key === 'Escape' && state.attachmentMenu !== null) {
    event.preventDefault()
    closeAttachmentMenu()
    return
  }
  if (event.key === 'Escape' && state.attachmentPreview !== null) {
    event.preventDefault()
    closeAttachmentPreview()
    return
  }
  if (event.key === 'Escape' && state.mode === 'canvas' && state.inspectorCardId !== null) {
    event.preventDefault()
    closeCardInspector({ animate: false })
    return
  }
  // Plain `m` closes the map. While the overlay is up this frame owns focus,
  // so the host page never sees the press; app.js asks it to close instead.
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key !== 'm' && event.key !== 'M') return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
  event.preventDefault()
  suspendMapInteraction()
  post('synapse:close')
})

app.addEventListener('contextmenu', event => {
  const chip = event.target instanceof Element ? event.target.closest('[data-action="open-attachment"]') : null
  if (!(chip instanceof HTMLElement)) return
  event.preventDefault()
  openAttachmentMenu({
    key: chip.dataset.key ?? '',
    cardId: chip.dataset.card ?? '',
    sessionId: chip.dataset.session ?? '',
    seq: Number.isInteger(Number(chip.dataset.seq)) && chip.dataset.seq !== '' ? Number(chip.dataset.seq) : undefined,
    name: chip.dataset.name ?? '附件',
    path: chip.dataset.path ?? '',
  }, event.clientX, event.clientY)
})

document.addEventListener('pointerdown', event => {
  if (state.attachmentMenu === null) return
  if (event.target instanceof Element && event.target.closest('.attachment-menu')) return
  closeAttachmentMenu()
}, true)

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.node-handle, textarea, select, form')) return
    // A double-click selects a word and a drag selects a range; neither is a
    // select-click, so leave the selection intact instead of re-rendering.
    if (event.detail > 1) return
    if (pointerDownPosition !== null
      && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4) return
    const thread = state.workspace?.threads.find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    state.activeId = thread.id
    state.selectedCardId = cardId
    cancelSessionLocate()
    openCardInspector(cardId)
    state.error = ''
    render()
    void loadThreadHistory(thread)
    // Bidirectional current-session sync: switch DSH's current session
    // without closing the map; the client confirms via synapse:current-session.
    if (thread.dshSessionId !== null) {
      if (thread.dshSessionId !== state.currentDsh?.id) state.mapCardSessionSwitches.add(thread.dshSessionId)
      post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    return
  }
  const thread = state.workspace?.threads.find(item => item.id === button.dataset.thread)
  try {
    if (button.dataset.action === 'return-global') return returnGlobal()
    if (button.dataset.action === 'fit-view') return fitCanvasView()
    if (button.dataset.action === 'open-search') return openMapSearch()
    if (button.dataset.action === 'preview-content') return openContentPreview()
    if (button.dataset.action === 'close-content-preview' || button.dataset.action === 'close-right-preview') { closeContentPreview(); return }
    if (button.dataset.action === 'close-search-results') { state.leftPanel = null; searchController.closeFlyout(); render(); return }
    if (button.dataset.action === 'toggle-attachments') {
      const cardId = button.dataset.card
      if (cardId !== undefined) {
        if (state.expandedAttachmentCards.has(cardId)) state.expandedAttachmentCards.delete(cardId)
        else state.expandedAttachmentCards.add(cardId)
        render()
      }
      return
    }
    if (button.dataset.action === 'open-attachment') {
      openAttachmentPreview({
        key: button.dataset.key ?? '',
        cardId: button.dataset.card ?? '',
        sessionId: button.dataset.session ?? '',
        seq: Number.isInteger(Number(button.dataset.seq)) && button.dataset.seq !== '' ? Number(button.dataset.seq) : undefined,
        name: button.dataset.name ?? '附件',
        path: button.dataset.path ?? '',
      })
      return
    }
    if (button.dataset.action === 'close-attachment-preview') return closeAttachmentPreview()
    if (button.dataset.action === 'attachment-open') return requestAttachmentAction(false)
    if (button.dataset.action === 'attachment-reveal') return requestAttachmentAction(true)
    if (button.dataset.action === 'attachment-copy-path') {
      const target = attachmentActionTarget()
      return target === null ? undefined : copyAttachmentText(absoluteAttachmentPath(target.path), target, '完整路径')
    }
    if (button.dataset.action === 'attachment-copy-folder') {
      const target = attachmentActionTarget()
      const directory = attachmentRevealDirectory(target?.path)
      return target === null || directory === '' ? undefined : copyAttachmentText(directory, target, '所在文件夹')
    }
    if (button.dataset.action === 'attachment-copy-name') {
      const target = attachmentActionTarget()
      return target === null ? undefined : copyAttachmentText(target.name ?? '', target, '文件名')
    }
    if (button.dataset.action === 'attachment-locate') {
      const target = attachmentActionTarget()
      state.attachmentMenu = null
      render()
      if (target !== null) post('synapse:open-session', { sessionId: target.sessionId, seq: Number.isInteger(target.seq) ? target.seq : undefined })
      return
    }
    if (button.dataset.action === 'follow-selection') {
      const followup = selectionFollowup
      hideSelectionFollowup()
      if (followup !== null && thread !== undefined && thread.id === followup.threadId && state.draft === null) openContinue(thread, undefined, followup.text)
      return
    }
    if (button.dataset.action === 'insert-quick-phrase' && button.dataset.quickPhrase !== undefined) insertQuickPhrase(button.dataset.quickPhrase)
    if (button.dataset.action === 'open-quick-phrase-editor') { state.quickPhraseEditorOpen = true; render() }
    if (button.dataset.action === 'close-quick-phrase-editor') { state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'add-quick-phrase') {
      const editor = button.closest('.draft-quick-phrase-add')
      const input = editor?.querySelector('input')
      if (input instanceof HTMLInputElement && addQuickPhrase(input.value)) {
        render()
        window.setTimeout(() => document.querySelector('.draft-quick-phrase-add input')?.focus(), 0)
      }
    }
    if (button.dataset.action === 'remove-quick-phrase') {
      const index = Number(button.dataset.quickPhraseIndex)
      if (Number.isInteger(index) && index >= 0 && index < state.quickPhrases.length) {
        state.quickPhrases.splice(index, 1)
        persistQuickPhrases()
        render()
      }
    }
    if (button.dataset.action === 'close') { suspendMapInteraction(); post('synapse:close') }
    if (button.dataset.action === 'close-card-inspector') { closeCardInspector(); return }
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) post('synapse:open-session', { sessionId: state.currentDsh.id })
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.mapCardSessionSwitches.clear()
      state.mapCardSessionSwitches.add(thread.dshSessionId)
      void locateSession(thread.dshSessionId).catch(setError)
      if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) { rgbSequence.cancel(); searchController.closeFlyout(); cancelSessionLocate(); resetAttachmentInteraction(); state.activeId = thread.id; state.mode = 'thread'; state.detailTargetCardId = button.dataset.card ?? null; render(); void loadThreadHistory(thread) }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; render() }
    if (button.dataset.action === 'toggle-card-children' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      const collapsing = !state.collapsedCardIds.has(cardId)
      if (collapsing && state.workspace !== null) {
        const allCards = conversationCards(state.workspace.threads)
        const nextCollapsed = new Set(state.collapsedCardIds).add(cardId)
        const visibleCards = conversationGraphView(allCards, nextCollapsed).cards
        const visibleIds = new Set(visibleCards.map(card => card.id))
        const draftParentId = draftPlacement(allCards)?.parent.id
        if (draftParentId !== undefined && !visibleIds.has(draftParentId)) return setError('请先完成或取消正在编辑的追问或分支')
        if (state.activeId !== null && !visibleCards.some(card => card.dshThreadId === state.activeId)) return setError('当前会话位于这个后续分支中，请先切换会话')
      }
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards()
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus(), 0)
    }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const requestedSeq = Number(button.dataset.seq)
      if (button.dataset.card !== undefined && !Number.isInteger(requestedSeq)) return setError('请等待这张卡片的最终回答后再创建分支')
      const fallbackSeq = latestMessage(thread, 'assistant')?.sourceSeq
      openBranch(thread, Number.isInteger(requestedSeq) ? requestedSeq : fallbackSeq, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'open-dsh' && thread?.dshSessionId !== null) post('synapse:open-session', { sessionId: thread.dshSessionId, seq: Number.isInteger(Number(button.dataset.seq)) ? Number(button.dataset.seq) : undefined })
    if (button.dataset.action === 'archive-thread' && thread !== undefined) await archiveThread(thread)
    if (button.dataset.action === 'zoom-in') zoomCanvasAtCenter(.1)
    if (button.dataset.action === 'zoom-out') zoomCanvasAtCenter(-.1)
    if (button.dataset.action === 'focus-active') { const sessionId = currentThread()?.dshSessionId; void locateSession(sessionId).catch(setError) }
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'layout' && state.workspace !== null) {
      if (state.browserMode === 'session') state.sessionPositions.clear(); else resetCardPositions()
      resetCanvasCamera()
      render()
    }
  } catch (error) { setError(error) }
})

app.addEventListener('change', event => {
  const quickPhrase = event.target instanceof Element ? event.target.closest('[data-quick-phrase-index]') : null
  if (quickPhrase instanceof HTMLInputElement) {
    updateQuickPhrase(Number(quickPhrase.dataset.quickPhraseIndex), quickPhrase.value)
    return
  }
  const select = event.target.closest('[data-action="select-workspace"]')
  if (!(select instanceof HTMLSelectElement)) return
  cancelSessionLocate()
  resetAttachmentInteraction()
  returnGlobal({renderAfter:false})
  const choice = workspaceChoices().find(item => item.id === select.value)
  if (choice?.source === 'all') {state.selectedDshWorkspaceId=null;state.workspace=aggregateWorkspace(state.allProjections);resetCanvasCamera();render();return}
  state.inspectorCardId = null
  state.inspectorOpening = false
  if (choice?.source === 'dsh') {
    // Map → native sync: switching workspaces moves DSH's current session to
    // the workspace's most recently updated session, keeping both sides in step.
    void openDshWorkspace(choice.id).then(opened => {
      if (!opened || !mapInteractive || state.selectedDshWorkspaceId !== choice.id) return
      const threads = state.workspace?.threads ?? []
      const latest = threads
        .filter(thread => thread.dshSessionId !== null)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
      const sessionId = latest?.dshSessionId ?? choice.sessionIds[0]
      if (sessionId !== undefined) post('synapse:activate-session', { sessionId })
    }).catch(setError)
  } else if (choice !== undefined) { state.selectedDshWorkspaceId = null; void openWorkspace(choice.id).catch(setError) }
})
app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = state.workspace?.threads.find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.source !== 'dsh-synapse') return
  const data = event.data
  if (data.type === 'synapse:map-closed') { suspendMapInteraction(); return }
  if (data.type === 'synapse:map-opened') {
    mapInteractive = true
    // Do NOT reset the camera here: toggling dialog<->map for the same
    // session must keep the user's viewport. A fresh canvas (canvasView
    // not initialized) still centers via renderCanvas; a real session switch
    // re-centers in the current-session handler below.
    state.awaitingInitialCurrent = true
    returnGlobal({ renderAfter: false })
    state.mode = 'canvas'
    render()
    void refreshSummaries().catch(setError)
    window.requestAnimationFrame(() => { if (mapInteractive) post('synapse:map-ready') })
  }
  if (data.type === 'synapse:host-style' && data.tokens) {
    for (const key of ['font-family','font-size','line-height','color']) { const value = data.tokens[key]; if (typeof value === 'string' && value.length < 300) document.documentElement.style.setProperty('--dsh-' + key, value) }
  }
  if (data.type === 'synapse:search') { if (mapInteractive) openMapSearch(); return }
  if (data.type === 'synapse:theme') {
    document.documentElement.dataset.theme = data.dark === true ? 'dark' : 'light'
  }
  if (data.type === 'synapse:workspaces') {
    state.dshWorkspaces = Array.isArray(data.workspaces) ? data.workspaces.filter(workspace => typeof workspace?.id === 'string' && typeof workspace.title === 'string' && Array.isArray(workspace.sessionIds)) : []
    if (!mapInteractive) return
    if (canReplaceView()) render()
  }
  if (data.type === 'synapse:current-session') {
    const previousId = state.currentDsh?.id
    state.currentDsh = data.session
    if (!mapInteractive) return
    const changed = previousId !== data.session?.id
    const preserveCamera = changed && state.mapCardSessionSwitches.delete(data.session?.id)
    const navigate = data.navigate === true || (data.navigate === undefined && changed && !state.awaitingInitialCurrent)
    state.awaitingInitialCurrent = false
    if (navigate && !preserveCamera && data.session?.id) void locateSession(data.session.id).catch(setError)
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:live-reply' && typeof data.sessionId === 'string') {
    if (!mapInteractive) return
    const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      if (data.running === true) {
        state.liveReplies.set(data.sessionId, { running: true, text: typeof data.text === 'string' ? data.text : '' })
        // Streaming: patch the live card's answer in place instead of
        // rebuilding the whole canvas on every chunk; a full render reconciles
        // at stream end. The detail view is single-thread, so keep its cheap
        // throttled full render.
        if (state.mode === 'canvas') scheduleLiveCardUpdate(data.sessionId)
        else if (canReplaceView()) scheduleLiveRender()
      } else {
        state.liveReplies.delete(data.sessionId)
        if (canReplaceView() || state.pendingReplies.has(data.sessionId)) renderPreservingDetailScroll()
      }
    }
  }
  if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'synapse:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined && data.code !== 'session-unavailable' && data.message !== '关联的 DSH 会话已不可用') setError(data.message); else if (data.code === 'session-unavailable') console.warn('[synapse] missing target session', data.sessionId) }
})

// Shared feature state lives in state; controllers own only their transient resources.
let featureChangeFrame = 0
let panelCancels = []
let previousPanelKeys = new Set()
let featureRendering = false
let searchAttachmentRevision = 0
let closingPanels = new Set()
const previewController = SynapsePanels.create({ onChange: () => queueFeatureUpdate() })
const searchController = SynapseSearch.create({
  loadRecords: async signal => searchRecords(await fetchAllProjections(signal)),
  onChange: (snapshot, reason) => {
    if (snapshot.open && ['open','query','mode'].includes(reason)) state.leftPanel = 'search'
    if (reason === 'close' && state.leftPanel === 'search') state.leftPanel = null
    queueFeatureUpdate()
  },
  onLocate: record => void locateSearchRecord(record),
  onAttachment: (record, attachment) => void openSearchAttachment(record, attachment ?? record.attachment),
  getFlyoutBounds: () => {
    const viewport = document.querySelector('.canvas-viewport')
    if (!viewport) return {left:0,top:0,width:window.innerWidth,height:window.innerHeight}
    const rect = viewport.getBoundingClientRect(), area = visibleCanvasRect(viewport)
    return {left:rect.left+area.x,top:rect.top+area.y,width:area.width,height:area.height}
  },
})
const rgbSequence = SynapseSessionCanvas.createSequence({
  getElement: id => document.querySelector(`.thread-card[data-card-id="${selectorValue(id)}"]`),
  reducedMotion: () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
})

async function fetchAllProjections(signal) {
  const summaries = state.summaries.length ? state.summaries : (await api('/synapse/api/workspaces', {signal})).workspaces
  const results = new Array(summaries.length)
  let cursor = 0
  await Promise.all(Array.from({length:Math.min(4,summaries.length)}, async () => {
    while (cursor < summaries.length) { const index = cursor++; results[index] = (await api(`/synapse/api/workspaces/${summaries[index].id}`, {signal})).workspace }
  }))
  return results
}
function aggregateWorkspace(projections) {
  const unique = new Map()
  for (const workspace of projections) for (const thread of workspace.threads ?? []) unique.set(thread.id, thread)
  return {id:'all',title:'全部会话',cwd:null,threads:[...unique.values()]}
}
function searchRecords(projections) {
  const records = []
  for (const workspace of projections) {
    const cards = conversationCards(workspace.threads ?? [], {layout:false})
    const threads = new Map((workspace.threads ?? []).map(t => [t.id,t]))
    for (const card of cards) {
      const thread = threads.get(card.dshThreadId)
      const messages = messagesFor(thread)
      let start = messages.findIndex(m => m.kind === 'user' && m.sourceSeq === card.sourceSeq)
      if (start < 0) start = messages.map((m,i)=>m.kind==='user'?i:-1).filter(i=>i>=0)[card.turnIndex] ?? -1
      let end = start + 1
      while (end < messages.length && messages[end].kind !== 'user') end++
      const text = start < 0 ? card.question ?? '' : messages.slice(start,end).filter(m=>m.kind==='user'||m.kind==='assistant').map(m=>m.text??'').join('\n\n')
      records.push({id:card.id,cardId:card.id,threadId:thread.id,sessionId:thread.dshSessionId,workspaceId:workspace.id,sessionTitle:threadListTitle(thread),text,question:card.question,turnIndex:card.turnIndex,attachments:card.attachments ?? []})
    }
  }
  return records
}
function captureView() {
  return {camera:{...state.canvasCamera},zoom:state.zoom,activeId:state.activeId,selectedCardId:state.selectedCardId,initialized:state.canvasViewInitialized,collapsed:new Set(state.collapsedCardIds),workspace:state.workspace,selectedDshWorkspaceId:state.selectedDshWorkspaceId}
}
function restoreView(view) {
  state.canvasCamera = {...view.camera}; state.zoom = view.zoom
  state.activeId = view.activeId; state.selectedCardId = view.selectedCardId
  state.canvasViewInitialized = view.initialized; state.canvasNeedsCenter = false
  state.collapsedCardIds = new Set(view.collapsed)
}
function enterSessionMode(sessionId) {
  if (state.browserMode === 'session' && state.sessionTarget === sessionId) return
  if (state.browserMode === 'global') state.globalView = captureView()
  else state.sessionViews.set(state.sessionTarget, captureView())
  rgbSequence.cancel()
  state.browserMode = 'session'; state.sessionTarget = sessionId
  const saved = state.sessionViews.get(sessionId)
  if (saved) restoreView(saved)
  else { state.collapsedCardIds = new Set(); state.canvasViewInitialized = true; state.canvasNeedsCenter = false }
}
function returnGlobal({renderAfter=true} = {}) {
  cancelSessionLocate(); rgbSequence.cancel(); searchController.closeFlyout(); resetAttachmentInteraction()
  state.inspectorCardId = null
  if (state.browserMode === 'session') {
    state.sessionViews.set(state.sessionTarget,captureView())
    if (state.globalView) {
      restoreView(state.globalView)
      state.selectedDshWorkspaceId = state.globalView.selectedDshWorkspaceId
      const all = aggregateWorkspace(state.allProjections)
      const group = state.dshWorkspaces.find(w=>w.id === state.selectedDshWorkspaceId)
      state.workspace = group ? {...all,id:`dsh:${group.id}`,title:group.title,cwd:group.path,threads:all.threads.filter(t=>group.sessionIds.includes(t.dshSessionId))} : state.globalView.workspace?.id === 'all' ? all : state.allProjections.find(w=>w.id === state.globalView.workspace?.id) ?? all
    }
  }
  state.globalView = null; state.browserMode = 'global'; state.sessionTarget = null; state.mode = 'canvas'
  if (renderAfter) render()
}
function sessionLayout(cards, threads) {
  const viewport = document.querySelector('.canvas-viewport')
  const width = viewport ? visibleCanvasRect(viewport).width : Math.max(310,window.innerWidth - (state.sidebarCollapsed ? 56 : 280))
  const cardWidth = window.innerWidth <= 560 ? 280 : CARD_WIDTH
  const result = SynapseSessionCanvas.layout(cards,threads,state.sessionTarget,{width,cardWidth,cardHeight:CARD_HEIGHT,gapX:55,gapY:70,insetX:48,insetY:48})
  return result
}
function fitCanvasView() {
  const cards = state.canvasCards ?? [], viewport = document.querySelector('.canvas-viewport')
  if (!cards.length || !viewport) return
  const area = visibleCanvasRect(viewport)
  const left = Math.min(...cards.map(c=>c.position.x)), top = Math.min(...cards.map(c=>c.position.y))
  const right = Math.max(...cards.map(c=>c.position.x+CARD_WIDTH)), bottom = Math.max(...cards.map(c=>c.position.y+CARD_HEIGHT))
  state.zoom = Math.max(.6,Math.min(1,(area.width-48)/(right-left),(area.height-48)/(bottom-top)))
  state.canvasCamera = {x:area.x+24-left*state.zoom,y:area.y+24-top*state.zoom}
  state.canvasViewInitialized = true; state.canvasNeedsCenter = false
  render()
}
async function locateSearchRecord(record) {
  const mode = state.browserMode
  await locateSession(record.sessionId,{cardId:record.cardId,sessionMode:mode==='session',animate:false})
}
async function openSearchAttachment(record, attachment) {
  if (!attachment) return
  const epoch = mapEpoch
  const locating = locateSearchRecord(record)
  const revision = searchAttachmentRevision
  await locating
  if (!mapInteractive || epoch !== mapEpoch || revision !== searchAttachmentRevision || !state.canvasCardsById?.has(record.cardId)) return
  openAttachmentPreview({key:attachment.key,cardId:record.cardId,sessionId:record.sessionId,seq:attachment.messageSeq,name:attachment.name,path:attachment.path})
}
function openMapSearch() {
  if (state.mode !== 'canvas') {state.mode='canvas';render()}
  state.leftPanel = 'search'
  searchController.open()
  updateFeaturePanels()
  searchController.focus()
}
function leftPanelMarkup() {
  if (state.leftPanel === 'attachment') return attachmentPreviewPanel()
  if (state.leftPanel === 'search' && searchController.snapshot().open) return SynapsePanels.shell({side:'left',kind:'search',title:'搜索结果 · 全部会话',body:searchController.renderResults(),closeAction:'close-search-results'})
  return ''
}
function cancelPanelAnimations() { panelCancels.forEach(cancel=>cancel()); panelCancels=[]; window.cancelAnimationFrame(featureChangeFrame); featureChangeFrame=0; for(const item of closingPanels){item.cancel();window.clearTimeout(item.timer);item.element.remove()}closingPanels.clear() }
function capturePanels() {return [...document.querySelectorAll('[data-map-panel]')].map(panel=>({rect:panel.getBoundingClientRect(),clone:panel.cloneNode(true),key:panel.dataset.mapPanel||panel.dataset.panelKind||'attachment'}))}
function animateClosingPanels(captured) {
  if (SynapsePanels.reducedMotion()) return
  for(const {rect,clone,key} of captured) {
    if(previousPanelKeys.has(key))continue
    clone.removeAttribute('data-map-panel');clone.setAttribute('aria-hidden','true');clone.inert=true
    clone.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;bottom:auto;right:auto;pointer-events:none;z-index:50`
    document.body.appendChild(clone)
    const item={element:clone,cancel:SynapsePanels.animate(clone,{opening:false,particles:false}),timer:null}
    item.timer=window.setTimeout(()=>{item.cancel();clone.remove();closingPanels.delete(item)},170)
    closingPanels.add(item)
  }
}
function queueFeatureUpdate() {
  if (!mapInteractive || featureRendering || featureChangeFrame) return
  featureChangeFrame = window.requestAnimationFrame(()=>{featureChangeFrame=0;if(mapInteractive)updateFeaturePanels()})
}
function mountFeaturePanels() {
  const bar = document.querySelector('.map-search-slot')
  if (bar && !searchController.snapshot().composing) bar.innerHTML = searchController.renderBar()
  searchController.mount(app)
  const keys = new Set()
  for (const panel of document.querySelectorAll('[data-map-panel]')) {
    const key = panel.dataset.mapPanel || panel.dataset.panelKind || 'attachment'
    keys.add(key)
    if (!previousPanelKeys.has(key)) panelCancels.push(SynapsePanels.animate(panel))
  }
  previousPanelKeys = keys
}
function updateFeaturePanels() {
  featureRendering = true
  const active = document.activeElement
  const isSearchInput = active?.closest?.('.map-search-slot') && active.tagName === 'INPUT'
  const selection = isSearchInput ? [active.selectionStart,active.selectionEnd] : null
  const scroll = document.querySelector('.map-left-slot .map-panel-body')?.scrollTop ?? 0
  const departing = capturePanels()
  cancelPanelAnimations()
  const left = document.querySelector('.map-left-slot'), right = document.querySelector('.map-right-slot')
  if (left) left.innerHTML = leftPanelMarkup()
  if (right) right.innerHTML = previewController.renderPreview(escapeHtml)
  mountFeaturePanels()
  animateClosingPanels(departing)
  const body = document.querySelector('.map-left-slot .map-panel-body'); if(body)body.scrollTop=scroll
  if (selection) { searchController.focus(); const input=document.querySelector('.map-search-slot input'); input?.setSelectionRange(...selection) }
  observeCanvasLayout()
  featureRendering = false
}
function openContentPreview() {
  const target = state.attachmentPreview ?? state.selectedAttachment
  if (!target) return
  const viewport = document.querySelector('.canvas-viewport')
  if ((viewport?.clientWidth ?? 0) < 1100) state.leftPanel = null
  state.inspectorCardId = null
  void previewController.openPreview(target)
  updateFeaturePanels()
}
function closeContentPreview() {
  previewController.closePreview()
  updateFeaturePanels()
  const chip=state.selectedAttachment
  const trigger=[...document.querySelectorAll('[data-action="open-attachment"]')].find(el=>el.dataset.card===chip?.cardId && el.dataset.key===chip?.key)
  ;(document.querySelector('[data-action="preview-content"]') ?? trigger ?? document.querySelector('[data-action="focus-active"]'))?.focus({preventScroll:true})
}
function closeMapPanels() {
  if (!state.leftPanel && !previewController.snapshot().open && state.inspectorCardId === null) return
  state.leftPanel = null; previewController.closePreview(); searchController.closeFlyout()
  state.inspectorCardId = null; state.attachmentMenu = null
  cancelAttachmentAction()
  render()
}
function handleFeatureEscape() {
  if (searchController.hasFlyout()) { searchController.closeFlyout(); return true }
  if (state.attachmentMenu) return false
  if (previewController.snapshot().open) { closeContentPreview(); return true }
  if (state.leftPanel) { state.leftPanel=null; resetAttachmentInteraction(); render(); return true }
  if (searchController.snapshot().open) { searchController.close(); updateFeaturePanels(); return true }
  return false
}

post('synapse:request-current')
refreshSummaries().catch(setError)
let polling = false
let liveRenderTimer = 0
let liveCardFrame = 0
let liveCardSessionId = null
function scheduleLiveCardUpdate(sessionId) {
  // Coalesce streaming chunks to one DOM patch per animation frame.
  liveCardSessionId = sessionId
  if (liveCardFrame !== 0) return
  liveCardFrame = window.requestAnimationFrame(() => {
    liveCardFrame = 0
    if (liveCardSessionId === null) return
    const id = liveCardSessionId
    liveCardSessionId = null
    applyLiveReplyToCard(id)
  })
}
function applyLiveReplyToCard(sessionId) {
  if (state.mode !== 'canvas') return
  // Never patch cards mid-gesture: the reflow would compete with the drag or
  // pan frame; the next live-reply chunk re-applies after the gesture ends.
  if (state.dragging || state.canvasGesture) return
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  if (thread === undefined) return
  const live = state.liveReplies.get(sessionId)
  if (live?.running !== true) return
  const cards = app.querySelectorAll(`.thread-card[data-thread="${CSS.escape(thread.id)}"]`)
  const card = cards[cards.length - 1]
  if (!(card instanceof HTMLElement)) return
  const answer = card.querySelector('.thread-answer')
  if (!(answer instanceof HTMLElement)) return
  const text = live.text
  answer.innerHTML = text.trim() === ''
    ? '<p class="thread-answer-pending">正在回复</p>'
    : `${renderMarkdown(text)}<p class="thread-answer-pending">正在回复</p>`
}
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}
async function pollProjection() {
  if (polling || !mapInteractive || document.hidden || !canReplaceView()) return
  polling = true
  try {
    await refreshProjection()
  } finally { polling = false }
}
const projectionPollTimer = window.setInterval(() => { void pollProjection().catch(setError) }, 1_000)
window.addEventListener('pagehide', () => window.clearInterval(projectionPollTimer))
