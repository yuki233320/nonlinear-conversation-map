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
