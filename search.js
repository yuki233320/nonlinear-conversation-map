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
