/**
 * test/_stubs.mjs —— 浏览器半边用例要用的三份桩。
 *
 * 口径（sysops 那条"假桩不许比宿主能多、也不许比宿主少"）：这三份桩只实现
 * dsh 0.2.0-rc.2 真机**已文档化**的行为，且逐条注明出处。桩多带一个键 = 替宿主圆谎，
 * 真机才炸。
 */

/** 最小 React 桩：createElement 把 children 并进 props（真 React 同形），hooks 单槽返回初值。 */
export function makeStubReact() {
  let cursor = 0;
  let forced = [];
  const SKIP = Symbol('skip');
  return {
    __skip: SKIP,
    __reset() { cursor = 0; forced = []; },
    __force(...vals) { forced = vals.slice(); },
    createElement(type, props, ...children) {
      const p = props ? { ...props } : {};
      if (children.length) p.children = children.length === 1 ? children[0] : children;
      return { type, props: p, children };
    },
    useState(init) {
      const own = () => (typeof init === 'function' ? init() : init);
      let v = own();
      cursor += 1;
      if (forced.length) { const f = forced.shift(); if (f !== SKIP) v = f; }
      return [v, () => {}];
    },
    useEffect() { cursor += 1; },
    useRef(v) { cursor += 1; return { current: v === undefined ? null : v }; },
    useMemo(fn) { cursor += 1; return fn(); },
    useCallback(fn) { cursor += 1; return fn; },
  };
}

/** 遍历节点树，收集文案 / 类名 / 按钮，供画面断言用。 */
export function walk(node, out = { texts: [], classes: [], buttons: [] }) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  if (typeof node === 'string' || typeof node === 'number') { out.texts.push(String(node)); return out; }
  if (typeof node.type === 'function') { walk(node.type(node.props ?? {}), out); return out; }
  if (node.props?.className) out.classes.push(String(node.props.className));
  // children 只走一遍：createElement 同时把 children 塞进 props.children 与 node.children，
  // 两处都走会让每个节点被重复摊开（指数级），按钮里再套一层收集就直接爆栈。
  const kids = node.children && node.children.length ? node.children : node.props?.children;
  if (node.type === 'button') out.buttons.push({ text: textOf(kids), props: node.props });
  if (kids !== undefined) walk(kids, out);
  return out;
}
/** 子树文案：不复用 walk —— walk 遇到 button 会再来收集一次，自递归。 */
function textOf(node, acc = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return acc.join(' ');
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, acc)); return acc.join(' '); }
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc.join(' '); }
  if (typeof node.type === 'function') return textOf(node.type(node.props ?? {}), acc);
  const kids = node.children && node.children.length ? node.children : node.props?.children;
  if (kids !== undefined) textOf(kids, acc);
  return acc.join(' ');
}

/**
 * ctx.theme 桩 —— 只实现 ThemeRuntime 文档化的那两面：
 *   overrideTokens(source, {token:{light,dark}}) 折层；**两档缺一即抛**（真机原文：
 *   "a bare string value throws a teaching error"）；同 source 再调用是替换整层；返回 disposer。
 *   getTheme() 返回 {active:{colorScheme, tokens}}，tokens 已按当前档挑好值。
 * 没有 register / setTheme / 事件：本骨架不用它们，桩也不提供（提供了就等于替宿主多给一条路）。
 */
export function makeStubTheme({ scheme = 'light' } = {}) {
  const layers = new Map();
  const api = {
    calls: [],
    scheme,
    setScheme(s) { api.scheme = s; },
    getTheme() {
      const tokens = {};
      for (const [, layer] of layers) {
        for (const [name, modes] of layer) tokens[name] = modes[api.scheme];
      }
      return { active: { colorScheme: api.scheme, tokens }, themes: [], preference: api.scheme, revision: api.calls.length };
    },
    overrideTokens(source, tokens) {
      api.calls.push({ source, tokens });
      if (!tokens || typeof tokens !== 'object') throw new TypeError('overrideTokens: tokens 必须是对象');
      const layer = new Map();
      for (const [name, modes] of Object.entries(tokens)) {
        if (!modes || typeof modes !== 'object' || typeof modes.light !== 'string' || typeof modes.dark !== 'string') {
          throw new TypeError(`overrideTokens: ${name} 必须同时给 {light, dark} 两个值`);
        }
        layer.set(name, { light: modes.light, dark: modes.dark });
      }
      layers.set(source, layer);
      return () => { if (layers.get(source) === layer) layers.delete(source); };
    },
  };
  return api;
}

/**
 * ctx.slots 桩 —— 实现 SlotMap 文档化的遮蔽规则：
 *   kind 'single' 的格子按 priority 升序排，**最低的那条渲染**；同格同 priority 的第二次注册抛错并点名占位者。
 *   register 返回 disposer；inject(name, cb) 立即回调（真机是等声明出现，用例里等价）。
 *   cb 返回生成器时按 Cordis 协程逐个 yield 收下 disposer。
 */
export function makeStubSlots({ officialBrandPriority = 0 } = {}) {
  const cells = new Map();
  const log = [];
  const ensure = (name) => {
    if (!cells.has(name)) cells.set(name, []);
    return cells.get(name);
  };
  const api = {
    log,
    /** 协程 yield 出来的收口句柄，测试可用 `slots.teardownAll()` 模拟插件卸载。 */
    disposers: [],
    teardownAll() { const list = api.disposers.splice(0); for (const d of list) d(); },
    entriesOfSlot(name) {
      const list = cells.get(name) ?? [];
      if (!list.length) return [];
      return [list.slice().sort((a, b) => a.priority - b.priority)[0]];
    },
    inject(name, cb) {
      log.push({ phase: 'inject', name });
      const r = typeof cb === 'function' ? cb() : undefined;
      if (r && typeof r[Symbol.iterator] === 'function' && typeof r.next === 'function') {
        // 生成器 yield 出来的是**留给卸载时收口的 disposer**（Cordis 协程语义），
        // 当场调用它等于把刚注册的填充又撤掉 —— 上一版桩就是这么把 brand 注册抹掉的。
        for (const disposer of r) { if (typeof disposer === 'function') api.disposers.push(disposer); }
      }
      return undefined;
    },
    register(opts, component) {
      const name = opts?.name;
      if (!name) throw new Error('register: 缺 name');
      const priority = opts.priority ?? 0;
      const list = ensure(name);
      const hit = list.find((e) => e.priority === priority);
      if (hit) {
        // 报错原文照抄宿主 dsh-client-ui-slots/lib/index.js:168,172（0.1.7 装包，desktop 0.2.0 asar 同名槽位）：
        // 桩把话术换成中文，用例就等于在测桩的措辞而不是测真机会说什么。
        throw new Error(`single slot "${name}" already has a registration at priority ${priority}`
          + `${hit.registrant !== undefined ? ` (registered by ${hit.registrant})` : ''}`
          + ` — register at a different priority to shadow it (lowest renders)`);
      }
      const entry = { name, priority, component, registrant: opts.registrant, label: opts.id ?? opts.key ?? component?.name ?? 'entry' };
      list.push(entry);
      log.push({ phase: 'register', name, priority });
      return () => {
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
        // 撤销也记一笔：真机上"换一枚标志"必须是「撤掉旧的 + 占上新的」这一对动作
        // （宿主只在注册表变化时重画，光改我们自己的状态它看不见）。有了这条日志，
        // ap-42/ap-43 才能断言"该重挂的重挂了、不该重挂的没动"。
        log.push({ phase: 'unregister', name });
      };
    },
    /** 让官方品牌包先占位（真机 desktop 构建里它就是内置启用的），用例据此验遮蔽。 */
    occupyOfficialBrand(names = ['sidebar.brand.mark', 'sidebar.brand.name']) {
      for (const n of names) {
        api.register({ name: n, priority: officialBrandPriority, registrant: '@deepseek-ai/dsh-client-ui-brand-official' }, function OfficialFill() { return null; });
      }
    },
  };
  return api;
}

/** 一个能跑 client.js apply() 的假 ctx（slots / effect / inject 三面）。 */
export function makeClientCtx({ slots, theme, payload } = {}) {
  if (payload) globalThis[payload.key] = payload.value;
  return {
    slots,
    theme,
    effects: [],
    effect(fn, id) { this.effects.push(id); const d = fn(); return typeof d === 'function' ? d : () => {}; },
    inject(names, cb) {
      const face = {};
      for (const n of names) {
        if (!this[n]) throw new Error(`假 ctx 没有服务 ${n}`);
        face[n] = this[n];
      }
      cb(face);
    },
  };
}

/**
 * ctx.storageDomain 桩 —— 只实现 docs/host-capabilities.md 三 记下的那几面真机行为：
 *   `open(spec)` 是 **async**；同一个 domain 名开第二次抛 `already-open`（所以 close 必须被 await）；
 *   表句柄 `get(key)` **同步**从内存读、`put(key, value)` **异步**且落盘前过 valueSchema；
 *   `close()` 释放名字。
 * 不提供事务 / 订阅 / 版本迁移：本插件不用，桩提供了就等于替宿主多给一条路。
 */
export function makeStubStorage() {
  const openNames = new Set();
  /** `domain/table/key` → 已存在的记录：模拟"库里上一版就有一行"（改名/删皮肤之后的残留）。 */
  const seeded = new Map();
  const api = {
    openNames: [],
    closes: 0,
    failNextOpen: null,
    preseed(table, key, value) { seeded.set(`${table}/${key}`, value); },
    async open(spec) {
      if (api.failNextOpen) { const e = api.failNextOpen; api.failNextOpen = null; throw e; }
      if (openNames.has(spec.name)) throw new Error(`already-open: ${spec.name}`);
      const data = {};
      const tables = {};
      for (const [name, t] of Object.entries(spec.tables)) {
        data[name] = new Map();
        for (const [seedKey, value] of seeded) {
          const [tbl, ...rest] = seedKey.split('/');
          if (tbl === name) data[name].set(rest.join('/'), value);
        }
        tables[name] = {
          get(key) { return data[name].get(key); },
          async put(key, value) {
            t.valueSchema.parse(value); // 真机同样在写前过 schema，坏记录进不来
            data[name].set(key, value);
          },
          async delete(key) { data[name].delete(key); },
          entries() { return [...data[name].entries()]; },
          keys() { return [...data[name].keys()]; },
        };
      }
      openNames.add(spec.name);
      api.openNames.push(spec.name);
      return {
        table: (name) => tables[name],
        async close() { openNames.delete(spec.name); api.closes += 1; },
      };
    },
  };
  return api;
}
