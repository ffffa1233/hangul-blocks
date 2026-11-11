/*
 * dc-lite runtime
 * ----------------
 * 디자인 캔버스용 .dc.html 템플릿을 일반 브라우저에서 돌리기 위한 작은 런타임.
 * 이 프로젝트에서 쓰는 문법만 지원한다:
 *   - {{path}}            점(.)으로 이어진 값 조회 (식은 지원 안 함)
 *   - <sc-for list as>    반복, 안에서 {{as}} 와 {{$index}} 사용
 *   - <sc-if value>       조건부 렌더
 *   - onClick / onChange / onInput="{{handler}}"
 *   - class Component extends DCLogic { renderVals() { ... } }  + setState
 * 빌드 스크립트(build.mjs)가 템플릿을 <script type="text/x-dc-template"> 에 넣고,
 * 컴포넌트 클래스를 window.__DC_Component 로 노출한다.
 */
(function () {
  'use strict';

  // ---------- 컴포넌트 기반 클래스 ----------
  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
      this.__render = null;
    }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__render) this.__render();
    }
    forceUpdate() { if (this.__render) this.__render(); }
  }
  window.DCLogic = DCLogic;

  // ---------- 템플릿 파서 (문자열 → 트리) ----------
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);

  function parse(src) {
    const root = { tag: '#root', attrs: [], children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    const attrRe = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let last = 0, m;
    const pushText = (t) => {
      if (!t) return;
      if (/^\s*$/.test(t) && t.indexOf('\n') >= 0) return; // 줄바꿈만 있는 공백은 버림
      stack[stack.length - 1].children.push({ text: decode(t) });
    };
    while ((m = re.exec(src))) {
      pushText(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) { // 닫는 태그
        const name = m[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === name) { stack.length = i; break; }
        }
        continue;
      }
      const tag = m[2].toLowerCase();
      const attrs = [];
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[3] || ''))) {
        const v = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
        attrs.push([a[1], decode(v)]);
      }
      const node = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!VOID.has(tag) && !m[4]) stack.push(node);
    }
    pushText(src.slice(last));
    return root;
  }

  // ---------- 값 조회 ----------
  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    let v = scope[parts[0]];
    for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  const WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
  const HOLE = /\{\{([^}]+)\}\}/g;
  const str = (v) => (v === undefined || v === null || v === false ? '' : String(v));
  const interp = (s, scope) => s.replace(HOLE, (_, p) => str(lookup(p, scope)));
  const value = (s, scope) => { const w = WHOLE.exec(s); return w ? lookup(w[1], scope) : interp(s, scope); };

  // ---------- 트리 → 가상 노드 ----------
  const PROPS = new Set(['checked', 'disabled', 'value', 'selected']);
  function build(nodes, scope, out) {
    for (const n of nodes) {
      if (n.text !== undefined) { out.push({ text: interp(n.text, scope) }); continue; }
      const get = (k) => { const f = n.attrs.find((x) => x[0] === k); return f ? f[1] : undefined; };
      if (n.tag === 'sc-for') {
        const list = value(get('list') || '', scope) || [];
        const as = get('as') || 'item';
        list.forEach((item, i) => {
          const s = Object.create(scope);
          s[as] = item; s.$index = i;
          build(n.children, s, out);
        });
        continue;
      }
      if (n.tag === 'sc-if') {
        if (value(get('value') || '', scope)) build(n.children, scope, out);
        continue;
      }
      const v = { tag: n.tag, attrs: {}, props: {}, events: {}, children: [] };
      for (const [k, raw] of n.attrs) {
        if (k.startsWith('hint-')) continue;
        if (/^on[A-Z]/.test(k)) { const f = value(raw, scope); if (typeof f === 'function') v.events[k.slice(2).toLowerCase()] = f; continue; }
        const val = value(raw, scope);
        if (PROPS.has(k)) v.props[k] = k === 'value' ? str(val) : !!(val === '' ? true : val);
        else if (val !== false && val !== null && val !== undefined) v.attrs[k === 'classname' ? 'class' : k] = String(val);
      }
      build(n.children, scope, v.children);
      out.push(v);
    }
    return out;
  }

  // ---------- 가상 노드 → 실제 DOM (위치 기준 패치) ----------
  function create(v) {
    if (v.text !== undefined) return (v.el = document.createTextNode(v.text));
    const el = (v.el = document.createElement(v.tag));
    update(el, { attrs: {}, props: {}, events: {}, children: [] }, v);
    return el;
  }
  function update(el, o, v) {
    for (const k in o.attrs) if (!(k in v.attrs)) el.removeAttribute(k);
    for (const k in v.attrs) if (o.attrs[k] !== v.attrs[k]) el.setAttribute(k, v.attrs[k]);
    for (const k in v.props) {
      if (k === 'value') { if (el.value !== v.props[k]) el.value = v.props[k]; }
      else el[k] = v.props[k];
    }
    for (const k in o.props) if (!(k in v.props) && k !== 'value') el[k] = false;
    el.__h = el.__h || {};
    for (const k in v.events) {
      if (!el.__h[k]) el.addEventListener(k, (e) => { const f = el.__h[k]; if (f) f(e); });
      el.__h[k] = v.events[k];
    }
    for (const k in el.__h) if (!v.events[k]) el.__h[k] = null;
    patch(el, o.children, v.children);
  }
  function patch(parent, olds, news) {
    const n = Math.max(olds.length, news.length);
    for (let i = 0; i < n; i++) {
      const o = olds[i], v = news[i];
      if (!v) { if (o.el.parentNode === parent) parent.removeChild(o.el); continue; }
      if (!o) { parent.appendChild(create(v)); continue; }
      if (o.text !== undefined && v.text !== undefined) {
        v.el = o.el;
        if (o.text !== v.text) o.el.nodeValue = v.text;
      } else if (o.tag && o.tag === v.tag) {
        v.el = o.el;
        update(o.el, o, v);
      } else {
        parent.replaceChild(create(v), o.el);
      }
    }
  }

  // ---------- 마운트 ----------
  function mount() {
    const tplEl = document.getElementById('dc-template');
    const Comp = window.__DC_Component;
    if (!tplEl || !Comp) { console.error('[dc-lite] template or component missing'); return; }
    const tree = parse(tplEl.textContent);
    const defs = window.__DC_PROPS || {};
    const props = {};
    for (const k in defs) if (k[0] !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k].default;
    const comp = new Comp(props);
    if (!comp.state) comp.state = {};
    const host = document.createElement('div');
    host.id = 'dc-root';
    document.body.appendChild(host);
    let old = [], queued = false;
    const render = () => {
      queued = false;
      const vals = comp.renderVals ? comp.renderVals() : {};
      const next = build(tree.children, Object.assign(Object.create(null), vals), []);
      patch(host, old, next);
      old = next;
    };
    comp.__render = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
    render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', () => { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
