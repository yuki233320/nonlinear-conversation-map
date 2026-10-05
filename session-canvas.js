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
