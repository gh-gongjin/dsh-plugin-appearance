/**
 * test/client.test.mjs —— 浏览器半边（client.js）的加载骨架、皮肤层与 brand 占位。
 *
 * 三条最要紧的：
 *   ap-5 官方品牌包以 priority 0 占着那两格时，本插件的 -1 能不能成为"最低者"（真机遮蔽规则的唯一替身）；
 *   ap-8 皮肤缺一档时整层不应用（补一档就是把"切明暗就糊"藏进运行时）；
 *   ap-13 样式串里不许出现宿主内部选择器 —— 第一期"只走官方通道"这条红线得有用例咬。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeStubReact, walk, makeStubTheme, makeStubSlots } from './_stubs.mjs';
import { SKINS, SKIN_SOURCE, SKIN_NONE_ID, DEFAULT_SKIN_ID, skinChoices } from '../lib/skins.js';
import { BRAND_MARKS, BRAND_MODES, BRAND_NAME_MAX } from '../lib/marks.js';
import { LOGO_MIMES, LOGO_MAX_BYTES, LOGO_TARGETS } from '../lib/store.js';
import { GLOBAL_KEY, ROUTE_PREFIX, PANEL_ID as HOST_PANEL_ID } from '../lib/api.js';

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn(); passed += 1; console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push(name); console.log(`  FAIL  ${name}\n        ${process.env.AP_STACK ? e.stack : e.message.split('\n')[0]}`);
  }
}
/**
 * 异步用例：**登记进退队列，文件末尾按登记顺序串行跑**（不是调用点当场启动）。
 *
 * 为什么要这样：第五轮新加的 4 条异步断言漏写 `await`，一条都没跑（`process.exit` 抢在
 * 它们之前），套件却报全绿 —— 这个文件名下"忘了 await"已经是第三次了。改成登记制以后
 * 有两重好处：① 漏写 await 也照样会跑到、会算进总数；② 多条异步用例顺序执行，
 * 不会因为在同一时刻并发去抢 `globalThis` 上的桩（canvas / FileReader / fetch）而互相污染。
 * 调用点写不写 `await` 都一样（返回一个已 resolve 的 promise，只为读起来像一条用例）。
 */
const asyncCases = [];
function checkA(name, fn) {
  asyncCases.push({ name, fn });
  return Promise.resolve();
}

async function runAsyncCases() {
  for (const { name, fn } of asyncCases) {
    try {
      await fn(); passed += 1; console.log(`  PASS  ${name}`);
    } catch (e) {
      failures.push(name); console.log(`  FAIL  ${name}\n        ${process.env.AP_STACK ? e.stack : e.message.split('\n')[0]}`);
    }
  }
}

let loadedClient = null;
const fetchCalls = [];
/** 回报 / 存档 / 送图三条通道共用一个 fetch，用例按 url 筛。 */
let fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) });
globalThis.window = { __ModuleLoader__: { load: (def) => { loadedClient = def; } } };
globalThis.document = {
  createElement: () => ({ textContent: '', remove() {} }),
  head: { appendChild() {} },
};
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  return fetchImpl(url, init);
};
function setFetch(fn) { fetchImpl = fn; }
function resetFetch() {
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) });
  fetchCalls.length = 0;
}

await import('../client.js');
const ReactStub = makeStubReact();
const CLIENT = loadedClient.factory((name) => {
  if (name === 'react') return ReactStub;
  throw new Error('意外的 require: ' + name);
});
const T = CLIENT.__test;
/**
 * 模块刚 load 完、任何用例还没碰过时的初始账。resetRuntime 会自己填一份默认值，
 * 所以"进来到底原样不原样"必须拿这份对 —— 只看 reset 之后的状态，等于用例替实现把默认值写死第二遍。
 */
const INITIAL = { brandMode: T.runtime.brand.mode, skinId: T.runtime.skinId, rows: T.runtime.brandRows.length, declared: T.runtime.brandDeclared.size };

/** 每次用例前把模块内单点状态清干净：runtime 是共享的，脏状态会让下一条用例读到上一条的读数。 */
function resetRuntime() {
  Object.assign(T.runtime, {
    themeReady: false, skinId: null, appliedCount: 0, layerError: null,
    brand: { mode: 'off', markId: null, imageUrl: null, name: null, nameMode: 'off', nameImageUrl: null, error: null },
    spots: [], scheme: null, storeNote: null, boot: null,
    bootLoaded: false, markTouched: false, nameTouched: false, imageTouched: false, userChose: false,
  });
  T.runtime.brandRows.length = 0;
  T.runtime.brandDeclared.clear();
  T.clearBrand();
  delete T.runtime.reportFailed;
}
function hostPayload(overrides = {}) {
  globalThis[GLOBAL_KEY] = {
    panelId: HOST_PANEL_ID,
    label: '桌面外观',
    routePrefix: ROUTE_PREFIX,
    api: `${ROUTE_PREFIX}/api`,
    source: SKIN_SOURCE,
    defaultSkinId: DEFAULT_SKIN_ID,
    noneSkinId: SKIN_NONE_ID,
    marks: BRAND_MARKS,
    skins: SKINS.map((s) => ({ id: s.id, name: s.name, note: s.note, tokens: s.tokens })),
    ...overrides,
  };
}
/** 第一条真皮肤 id：默认档现在是"不覆盖"，用例要点皮肤就得点名一张。 */
const A_SKIN = SKINS[0].id;

check('ap-1 经 ModuleLoader 注册且 id 是包名', () => {
  assert(loadedClient, '未调用 window.__ModuleLoader__.load');
  assert.equal(loadedClient.id, 'dsh-plugin-appearance');
});

check('ap-2 导出形状与两侧常量同值（宿主半边 / 皮肤表 / 浏览器半边三份对齐）', () => {
  assert.equal(typeof CLIENT.apply, 'function');
  assert.deepEqual(CLIENT.inject, ['slots']);
  assert.equal(CLIENT.PANEL_ID, HOST_PANEL_ID);
  assert.equal(T.GLOBAL_KEY, GLOBAL_KEY);
  assert.equal(T.SKIN_SOURCE, SKIN_SOURCE);
  assert.equal(T.SKIN_NONE_ID, SKIN_NONE_ID);
  assert.equal(T.BRAND_PRIORITY, -1, 'brand 遮蔽档位必须是负数才盖得过官方的 0');
});

check('ap-3 没有宿主载荷（缺 webServer ⇒ 缺 routePrefix）→ 一个 slot 都不注册', () => {
  resetRuntime();
  delete globalThis[GLOBAL_KEY];
  const slots = makeStubSlots();
  CLIENT.apply({ slots, effect: (f) => f(), inject: () => {} });
  assert.equal(slots.log.length, 0, `不该有任何 slot 动作：${JSON.stringify(slots.log)}`);
});

function entryCtx({ theme = makeStubTheme(), slots = makeStubSlots(), payload = true } = {}) {
  if (payload) hostPayload();
  const ctx = {
    slots,
    theme,
    effects: [],
    effect(f, id) { this.effects.push(id); const d = f(); return typeof d === 'function' ? d : () => {}; },
    inject(names, cb) {
      const face = {};
      for (const n of names) face[n] = this[n];
      cb(face);
    },
  };
  CLIENT.apply(ctx);
  return { ctx, slots, theme };
}

check('ap-4 有载荷 → 面板入口两处照内置口径注册（列表项 + 主列 keyed）', () => {
  resetRuntime();
  const { slots } = entryCtx();
  const phases = slots.log.map((l) => `${l.phase}:${l.name}`);
  assert.ok(phases.includes('register:sidebar.panellist'), phases.join(' '));
  assert.ok(phases.includes('register:main'), phases.join(' '));
});

check('ap-5 进来一格 brand 都不占（官方 logo 留着）；用户挑了才以 -1 上位，挑回原样官方自己回来', () => {
  // 先对模块自己的初始账：默认值写错时 resetRuntime 会把正确的盖上去，只测之后看不见。
  assert.equal(INITIAL.brandMode, 'off', `client.js 里标志的默认档位不是"原样"：${INITIAL.brandMode}`);
  assert.equal(INITIAL.skinId, null, `配色默认不是"未应用"：${INITIAL.skinId}`);
  assert.equal(INITIAL.rows, 0, '模块一加载就有注册账');
  assert.equal(INITIAL.declared, 0, '模块一加载就以为宿主声明过格子');
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'conversation.hero.brand.mark']);
  const officialOf = (n) => slots.entriesOfSlot(n)[0].component.name;
  assert.equal(officialOf('sidebar.brand.mark'), 'OfficialFill', '前置条件：官方填充本来在渲染');
  entryCtx({ slots });
  assert.equal(officialOf('sidebar.brand.mark'), 'OfficialFill', '没点过就把官方 logo 换掉了 —— 用户要的是进来原样');
  assert.equal(T.runtime.brandRows.length, 0, `默认档不该有任何注册账：${JSON.stringify(T.runtime.brandRows)}`);

  // 挑一枚内置标志：两格图标位都要以 -1 上位（同档第二条会抛错，所以官方只能被"挤下去"而不是"叠上去"）。
  assert.equal(T.setBrand({ mode: 'builtin', markId: 'ring' }), true);
  assert.equal(officialOf('sidebar.brand.mark'), 'BrandMark', '-1 档没能把官方填充挤下去');
  assert.equal(officialOf('conversation.hero.brand.mark'), 'BrandMark', '首屏那格没跟着换');
  assert.equal(T.runtime.brandRows.filter((r) => r.ok).length, 2, JSON.stringify(T.runtime.brandRows));
  // 名称行（deepseek / HARNESS 字标）用户没要求改，必须仍是官方的。
  slots.register({ name: 'sidebar.brand.name', priority: 0, registrant: 'official' }, function OfficialName() { return null; });
  assert.equal(officialOf('sidebar.brand.name'), 'OfficialName');

  T.setBrand({ mode: 'off' });
  assert.equal(officialOf('sidebar.brand.mark'), 'OfficialFill', '挑回原样却没撤销注册 = 用户撤不掉');
  assert.equal(officialOf('conversation.hero.brand.mark'), 'OfficialFill');
  assert.equal(T.runtime.brandRows.length, 0);
});

check('ap-6 占位被拒时不崩、不换个正数档蒙混：把抛错原文记进读数交给界面交代', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  // 真机上"同格同 priority 第二次注册抛错并点名占位者"；这里用同档先占位复现那条抛错，
  // 验的是本插件的处置：捕获、记录、继续装配其余 slot。
  slots.register({ name: 'sidebar.brand.mark', priority: -1 }, function Preemptor() { return null; });
  entryCtx({ slots });
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const row = T.runtime.brandRows.find((r) => r.slot === 'sidebar.brand.mark');
  assert.equal(row.ok, false, '同档冲突本该抛错，却没记成失败');
  assert.match(row.error, /already has a registration/, `报错原文没带上宿主那句话：${row.error}`);
  assert.ok(T.runtime.brandRows.some((r) => r.slot === 'conversation.hero.brand.mark' && r.ok), '一格被拒不牵连另一格的注册');
  assert.ok(T.brandSummary().includes('没换成'), `界面上要读得出这一格没换成：${T.brandSummary()}`);
  // 再挑一次原样：失败那格也不该留下撤不掉的注册。
  T.setBrand({ mode: 'off' });
  assert.equal(T.runtime.brandRows.length, 0);
});

check('ap-7 进来不套任何配色层：overrideTokens 一次都不调，生效处数 0', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  assert.equal(theme.calls.length, 0, `默认就动了配色（${theme.calls.length} 次调用）—— 用户要的是进来原样`);
  assert.equal(T.runtime.skinId, SKIN_NONE_ID);
  assert.equal(T.runtime.appliedCount, 0);
  assert.equal(T.runtime.spots.length, 0);
  assert.equal(T.runtime.layerError, null);
  assert.equal(theme.getTheme().active.tokens['--dsw-alias-bg-base'], undefined, '宿主活动快照里出现了本插件的令牌');
});

check('ap-7b 点一张皮肤：一次 overrideTokens、source 正确、24 个令牌、抽查三个全一致', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  const ok = T.applySkin(theme, A_SKIN);
  assert.equal(ok, true);
  assert.equal(theme.calls.length, 1, `overrideTokens 调用次数应为 1，实得 ${theme.calls.length}`);
  assert.equal(theme.calls[0].source, SKIN_SOURCE);
  assert.equal(Object.keys(theme.calls[0].tokens).length, 24);
  assert.equal(T.runtime.skinId, A_SKIN);
  assert.equal(T.runtime.appliedCount, 24);
  assert.equal(T.runtime.spots.length, 3);
  assert.ok(T.runtime.spots.every((s) => s.ok), JSON.stringify(T.runtime.spots));
});

check('ap-8 皮肤缺一档 → 整层不应用，报错点名缺的令牌', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  const broken = { id: 'broken', name: '坏表', note: '', tokens: { ...SKINS[0].tokens } };
  broken.tokens['--dsw-alias-bg-base'] = { light: '#FFF' }; // 只有 light 档：切到暗档就露底
  globalThis[GLOBAL_KEY].skins = [...globalThis[GLOBAL_KEY].skins, broken];
  const ok = T.applySkin(theme, 'broken');
  assert.equal(ok, false);
  assert.equal(theme.calls.length, 0, '缺档的层不该送进宿主');
  assert.match(T.runtime.layerError, /缺 light\/dark 档/);
  assert.match(T.runtime.layerError, /--dsw-alias-bg-base/, `报错要点名缺的令牌：${T.runtime.layerError}`);
  assert.equal(T.runtime.skinId, SKIN_NONE_ID, '进来还是原样，报错不该把它写成"未应用"');

  // 已经有一层活着的时候再点坏表：那层没被撤，账就得照旧的记。
  T.applySkin(theme, A_SKIN);
  const before = { skinId: T.runtime.skinId, applied: T.runtime.appliedCount, spots: T.runtime.spots.length };
  assert.equal(T.applySkin(theme, 'broken'), false);
  assert.equal(theme.calls.length, 1, '坏表不该再送一层进去');
  assert.deepEqual({ skinId: T.runtime.skinId, applied: T.runtime.appliedCount, spots: T.runtime.spots.length }, before,
    '拒层之后把还在生效的账清成 0 = 界面在报假数');
});

check('ap-9 未知皮肤 id：不回落默认值冒充，如实报"未知皮肤"', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  const ok = T.applySkin(theme, 'nope');
  assert.equal(ok, false);
  assert.match(T.runtime.layerError, /未知皮肤 nope/);
  assert.equal(theme.calls.length, 1, '未知的 id 一个字节都不该送出去');
  assert.equal(T.runtime.skinId, A_SKIN, '上一张还在生效，账写成"未应用"就是界面在说谎');
  assert.equal(T.runtime.appliedCount, 24);
});

check('ap-10 "不覆盖"把整层摘掉：宿主活动快照里不再有我这些令牌', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  assert.ok(theme.getTheme().active.tokens['--dsw-alias-bg-base']);
  const ok = T.applySkin(theme, SKIN_NONE_ID);
  assert.equal(ok, true);
  assert.equal(theme.getTheme().active.tokens['--dsw-alias-bg-base'], undefined);
  assert.equal(T.runtime.appliedCount, 0);
  assert.equal(T.runtime.skinId, SKIN_NONE_ID);
});

check('ap-11 用户切到暗档后抽查跟着换档比对（两档都要能核对，不是只测 light）', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme({ scheme: 'light' });
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  assert.ok(T.runtime.spots.every((s) => s.ok), JSON.stringify(T.runtime.spots));
  theme.setScheme('dark');
  const skin = T.skinById(A_SKIN);
  const spots = T.spotCheck(theme, skin);
  assert.equal(T.runtime.scheme, 'dark');
  assert.ok(spots.every((s) => s.ok), JSON.stringify(spots));
  const dark = skin.tokens['--dsw-alias-bg-base'].dark;
  assert.equal(spots.find((s) => s.token === '--dsw-alias-bg-base').want, dark);
});

check('ap-12 theme 服务缺席：换肤不可用但不抛，选择皮肤的按钮禁用并写明原因', () => {
  resetRuntime();
  resetFetch();
  hostPayload();
  const slots = makeStubSlots();
  const ctx = {
    slots,
    theme: undefined,
    effect: (f) => f(),
    inject(names, cb) { if (names.includes('theme') && !this.theme) return; cb(this); },
  };
  CLIENT.apply(ctx);
  assert.equal(T.runtime.themeReady, false);
  const tree = ReactStub.createElement(CLIENT.AppearancePage, {});
  const out = walk(tree);
  assert.ok(out.texts.some((t) => t.includes('桌面外观')), `页面标题没画出来：${JSON.stringify(out.texts)}`);
  // 只断配色那一区（.ap-cards）的按钮：标志区不读配色通道，它的按钮本来就该照常可点。
  const cards = findByClass(CLIENT.AppearancePage({}), 'ap-cards');
  assert.equal(cards.length, 1, `配色区个数异常：${cards.length}`);
  const skinButtons = walk(cards[0]).buttons;
  assert.equal(skinButtons.length, SKINS.length + 1, `配色按钮个数对不上张数+不覆盖：${skinButtons.length}`);
  assert.ok(skinButtons.every((b) => b.props.disabled === true), 'theme 未就绪时配色按钮必须全禁用');
  assert.ok(out.texts.some((t) => t.includes('未就绪')), '界面上要看得见"为什么点不动"');
});

check('ap-13 样式串只画自己的界面：全部选择器以 .ap- 开头，不碰宿主 DOM、不用 !important', () => {
  const selectors = T.CSS.split('\n').map((line) => line.slice(0, line.indexOf('{')).trim()).filter(Boolean);
  assert.ok(selectors.length >= 12, `样式行数异常：${selectors.length}`);
  for (const sel of selectors) {
    assert.ok(sel.startsWith('.ap-'), `越界选择器（会盖到宿主界面上）：${sel}`);
    assert.ok(!/[#!]/.test(sel.replace(/\[.*?\]/g, '')), `选择器里不该出现 id 或 !：${sel}`);
  }
  assert.ok(!T.CSS.includes('!important'), '样式里不许出现 !important');
  assert.ok(!/body|html|:root/.test(T.CSS), '不得声明宿主画布级选择器');
});

check('ap-14 颜色一律读宿主令牌（皮肤换了本插件界面跟着换，不另存一份配色）', () => {
  const withColor = T.CSS.split('\n').filter((l) => /(background|color|border-color|box-shadow)/.test(l));
  assert.ok(withColor.length >= 6, `带颜色的行异常：${withColor.length}`);
  const hardCoded = withColor.filter((l) => !/var\(--dsw-alias-/.test(l) && !/box-shadow:0 0 0 1px var/.test(l));
  assert.deepEqual(hardCoded, [], `这些行写死了颜色：\n${hardCoded.join('\n')}`);
});

// 必须 await：末尾的 process.exit 会抢跑，异步用例就成了"根本没跑"却报绿。
await checkA('ap-15 回报送到宿主 report 通道，字段是白名单那六个，标志带的是档位不是花名', async () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  fetchCalls.length = 0;
  await T.postReport();
  const call = fetchCalls.find((c) => c.url === `${ROUTE_PREFIX}/api/report`);
  assert(call, `没往 ${ROUTE_PREFIX}/api/report 送：${JSON.stringify(fetchCalls.map((c) => c.url))}`);
  assert.equal(call.init.method, 'POST');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['applied', 'error', 'logo', 'scheme', 'skinId', 'spots']);
  assert.equal(body.skinId, A_SKIN);
  assert.equal(body.applied, '24');
  assert.match(body.logo, /^builtin:ring /, `回报里要能看出是哪一档：${body.logo}`);
  assert.match(body.logo, /sidebar\.brand\.mark=ok@-1/);
  // 名称行那一格得单独报——它是"两张脸"（文字 / 图片），页头那行只报"哪一样"，
  // 而 §5-U12/U13/U14 要判的正是那一格现在画的到底是什么。
  assert.match(body.logo, /名称行=官方/, `名称行那格没报出来：${body.logo}`);
  assert.equal(body.spots, 'bg-base:ok label-primary:ok brand-primary:ok', `抽查读数没带回来：${body.spots}`);
  // 默认档（原样）在回报里也得是一条读得出的话，而不是空串。
  resetRuntime();
  resetFetch();
  await T.postReport();
  const off = JSON.parse(fetchCalls.find((c) => c.url.endsWith('/report')).init.body);
  assert.equal(off.logo, '原样 名称行=官方');
  assert.equal(off.skinId, '');
  // 名称行有内容时，前缀仍是档位、尾巴换成"文字 / 图片"——既有的读法（^builtin:ring）不受影响。
  resetRuntime();
  resetFetch();
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  T.setBrandName('奋进的个人工作台');
  await T.postReport();
  const named = JSON.parse(fetchCalls.find((c) => c.url.endsWith('/report')).init.body);
  assert.match(named.logo, /^builtin:ring /, `前缀被挪动了：${named.logo}`);
  assert.match(named.logo, /名称行=文字/, named.logo);
  T.setBrandNameImage('/appearance/api/logo?which=name&v=7');
  resetFetch(); // 不重置的话下面 find 又会捞到上一条回报（那正是我第一次写这条时踩的坑）
  await T.postReport();
  const imaged = JSON.parse(fetchCalls.find((c) => c.url.endsWith('/report')).init.body);
  assert.match(imaged.logo, /名称行=图片/, imaged.logo);
});

check('ap-16 等三格的声明（两格图标位 + 名称行）；但"等声明"不等于"占位"，默认三格都还是官方的', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  const injected = [];
  const realInject = slots.inject.bind(slots);
  slots.inject = (name, cb) => { injected.push(name); return realInject(name, cb); };
  entryCtx({ slots });
  assert.ok(injected.includes('conversation.hero.brand.mark'), injected.join(','));
  assert.ok(injected.includes('sidebar.brand.mark'), injected.join(','));
  assert.ok(injected.includes('sidebar.brand.name'), `名称行现在要能被换，插件却没去等它的声明：${injected.join(',')}`);
  assert.deepEqual(T.BRAND_MARK_SLOTS, ['sidebar.brand.mark', 'conversation.hero.brand.mark']);
  assert.equal(T.BRAND_NAME_SLOT, 'sidebar.brand.name');
  assert.equal(T.runtime.brandDeclared.size, 3);
  // 默认态（没点过、没填过字）三格都必须还是官方的 —— 用户要的是"进来原样"。
  assert.equal(slots.entriesOfSlot('sidebar.brand.name')[0].component.name, 'OfficialFill');
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'OfficialFill');
  assert.equal(T.runtime.brandRows.length, 0);
});

check('ap-17 别的覆盖层抢走同一个令牌：抽查报"没生效"，不把"送进去了"当"生效了"', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  // 宿主规则：多层按叠放顺序折，后叠的赢。所以必须是**我们先叠、别人后叠**才盖得住我们
  // （桩里同 source 再调用是原位替换、异 source 才是追加）。真机的替换顺序是未决项
  // （spec §5-U3），本条只断"快照值和我不一样就必须报没生效"，不断谁赢。
  const ok = T.applySkin(theme, A_SKIN);
  assert.equal(ok, true, '本层注册本身没失败，不该报成应用失败');
  theme.overrideTokens('other-plugin', { '--dsw-alias-bg-base': { light: '#123456', dark: '#654321' } });
  T.runtime.spots = T.spotCheck(theme, T.skinById(A_SKIN));
  const bg = T.runtime.spots.find((s) => s.token === '--dsw-alias-bg-base');
  assert.notEqual(bg.want, bg.got, '前置条件没成立：快照值仍等于我送的值');
  assert.equal(bg.ok, false, '值都对不上还报一致 = 界面在说谎');
  const out = walk(ReactStub.createElement(CLIENT.AppearancePage, {}));
  assert.ok(out.texts.some((t) => t.includes('没生效')), `页面上要看得见这条没生效：${JSON.stringify(out.texts)}`);
});

check('ap-18 页面上写的数字与皮肤表/令牌夹具对齐（覆盖 24 / 真令牌 117 / 未覆盖 93）', () => {
  // 这条纯粹防文案自己漂：皮肤加一张、或宿主升级重采了令牌，界面上那句"只覆盖 N 个"就得跟着改，
  // 不改就是当着用户面报假数。
  const covered = Object.keys(SKINS[0].tokens).length;
  const realTokens = 117; // 与 sk-11 同值：夹具 120 行去掉 3 条前缀伪项
  const out = walk(ReactStub.createElement(CLIENT.AppearancePage, {}));
  assert.ok(out.texts.some((t) => t.includes(`只覆盖 ${covered} 个令牌`)), `文案里的覆盖数对不上：${JSON.stringify(out.texts.filter((t) => t.includes('只覆盖')))}`);
  assert.ok(out.texts.some((t) => t.includes(`真令牌共 ${realTokens} 个`) && t.includes(`其余 ${realTokens - covered} 个`)), '未覆盖数没算对或没写');
  // 用户 2026-10-03 明确要求删掉开发期脚手架（宿主回报回读那张卡）：钉住，别哪天自己长回来。
  assert.ok(!out.texts.some((t) => t.includes('宿主回报回读')), 'GET /state 回读卡是复核用的脚手架，不该留在用户界面上');
});

check('ap-19 除了那段就地声明，页面上不许出现开发期文案', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  // 把每一块都填上内容再扫：不套层时"界面实际读到的配色"那几行根本不渲染，
  // 那条断言就成了摆设（变异电池 M11 就是这么活下来的）。
  T.applySkin(theme, A_SKIN);
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  T.runtime.storeNote = '这台机器上存不住 —— 重启后回到原样';
  const out = walk(ReactStub.createElement(CLIENT.AppearancePage, {}));
  // 用户裁定保留原样的 Disclosure 那两段是"给使用者看的边界说明"，里面确实要提通道名，排除它。
  const userFacing = out.texts.filter((t) => !t.includes('本插件只改这个应用长什么样') && !t.includes('边界就地写明'));
  assert.ok(userFacing.length >= 20, `排除后剩下几条，用例等于没测：${userFacing.length}`);
  const banned = ['GET', '/api/', 'state', 'slot', 'priority', 'overrideTokens', 'theme', '骨架', '抽查',
    '回读', '复核', '探针', 'POC', '--dsw-alias-', 'token', '令牌', '覆盖层', 'storageDomain', 'data URL'];
  const hit = userFacing.filter((t) => banned.some((b) => t.includes(b)));
  assert.deepEqual(hit, [], `这些是给开发看的，不该出现在用户界面上：\n${hit.join('\n')}`);
  // 反面也要有：皮肤张数、标志枚数、明暗档名这些"跟使用有关"的文案要在。
  assert.ok(out.texts.some((t) => t.includes('墨蓝')), `内置皮肤该出现在选择区：${JSON.stringify(out.texts)}`);
  assert.ok(out.texts.some((t) => t.includes('高对比')), '八张里最后一张没画出来');
  assert.equal(out.texts.filter((t) => t === '原样').length, 1, '标志区那张"原样"卡片必须常驻');
});

/* ---- 标志自定义与存档（2026-10-03 第二轮需求） ---- */

check('ap-20 跨边界的常量对齐：档位 / 图片类型 / 图片上限 / 名称字数 / 图片的两个去处（浏览器挡一次是给人看话，宿主那次才是真的）', () => {
  assert.deepEqual(T.BRAND_MODES, BRAND_MODES, '标志档位两头不同值');
  assert.deepEqual(T.LOGO_ALLOWED_MIMES, LOGO_MIMES, '图片类型白名单两头不同值');
  assert.equal(T.LOGO_MAX_BYTES, LOGO_MAX_BYTES, '图片上限两头不同值：浏览器放到 201KB 会被宿主拒，用户只看到"存不下"');
  assert.equal(T.BRAND_NAME_MAX, BRAND_NAME_MAX, '名称字数上限两头不同值：输入框让填 30 字，宿主只收 24 字，用户会看到"没存住"却找不到原因');
  // 图片的两个去处：名字要对齐 —— 浏览器拿它拼 `?which=`，宿主拿它查白名单；
  // 两边差一个字母，用户就会看到"名称行那张图存不下"（而这看起来像路由坏了）。
  assert.deepEqual(T.LOGO_TARGETS, LOGO_TARGETS, '图片去处的名字两头不同值');
  assert.deepEqual(T.LOGO_TARGETS, ['mark', 'name'], '去处的取值变了：改这里就要同步 lib/store.js 的 ROW_KEY_OF');
  assert.equal(T.LOGO_TARGET_MARK, 'mark');
  assert.equal(T.LOGO_TARGET_NAME, 'name');
  assert.deepEqual(T.BRAND_MARK_SLOTS.length, 2);
  assert.ok(BRAND_MARKS.length >= 6, `内置标志只剩 ${BRAND_MARKS.length} 枚，选择区会空一块`);
});

/** 递归找出某一 class 的节点（walk 只收文案与类名，这里要的是节点本身）。函数组件要先摊开。 */
function findByClass(node, cls, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findByClass(n, cls, acc)); return acc; }
  if (typeof node.type === 'function') { findByClass(node.type(node.props ?? {}), cls, acc); return acc; }
  if (node.props?.className === cls) acc.push(node);
  const kids = node.children && node.children.length ? node.children : node.props?.children;
  if (kids !== undefined) findByClass(kids, cls, acc);
  return acc;
}
const childOf = (node) => (node.children && node.children.length ? node.children : node.props?.children);

/**
 * 递归找某个 props 值等于给定值的节点。
 * 为什么不复用 findByClass：它认的是**整串类名相等**，而"选图片"那个 label 身上是
 * `ap-name-b ap-name-pick`（有时还多一个 `ap-on`）—— 用类名精确匹配永远找不到它。
 * 走 `data-ap-id` 也更贴真实：那是它在界面上的身份，不是样式。
 */
function findByProp(node, key, value, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findByProp(n, key, value, acc)); return acc; }
  if (typeof node.type === 'function') { findByProp(node.type(node.props ?? {}), key, value, acc); return acc; }
  if (node.props?.[key] === value) acc.push(node);
  const kids = childOf(node);
  if (kids !== undefined) findByProp(kids, key, value, acc);
  return acc;
}

check('ap-21 标志预览各画各的那枚，不是当前生效的那枚（六张卡片画同一个图形等于没有选择器）', () => {
  resetRuntime();
  resetFetch();
  entryCtx({ theme: makeStubTheme() });
  // 当前是原样档：预览格若读 runtime，六张就会画成同一团。
  assert.equal(T.runtime.brand.mode, 'off');
  const tree = T.LogoSection({ onPick() {}, onFile() {}, busy: false, pickError: null });
  const previews = findByClass(tree, 'ap-preview');
  assert.equal(previews.length, BRAND_MARKS.length, `预览格个数对不上内置款数：${previews.length} vs ${BRAND_MARKS.length}`);
  const asked = previews.map((p) => childOf(p)[0].props.markId);
  assert.deepEqual(asked, BRAND_MARKS.map((m) => m.id), '预览没把这一枚的 id 传进去，六张画的是同一个图形');
  const flat = (n) => (Array.isArray(n) ? n.flatMap(flat) : [n]);
  const drawn = previews.map((p) => {
    const el = childOf(p)[0];
    // 按这张卡片自己要的那一枚渲染（宿主传 props 的同形），再看画出来的几何：
    // 六张若都读 runtime，markIds 那条会绿、形状这条会红。
    return JSON.stringify(flat(el.type({ ...el.props, size: 34 }).children).map((n) => n.props?.d ?? `${n.props?.cx},${n.props?.cy},${n.props?.r}`));
  });
  assert.equal(new Set(drawn).size, BRAND_MARKS.length, '六张预览画出来的形状有重复');
});

await checkA('ap-22 挑皮肤会把选择送去宿主存档；宿主回错时界面上写明"下次重启回到原样"', async () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  fetchCalls.length = 0;
  const ok = await T.persistSkin(A_SKIN);
  assert.equal(ok, true);
  const call = fetchCalls.find((c) => c.url === `${ROUTE_PREFIX}/api/prefs`);
  assert(call, `没送存档：${JSON.stringify(fetchCalls.map((c) => c.url))}`);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { skinId: A_SKIN });

  setFetch(async () => ({ ok: true, json: async () => ({ ok: false, error: { code: 'UNKNOWN_SKIN', message: '没有这张皮肤' } }) }));
  const failed = await T.persistSkin('gone');
  assert.equal(failed, false, '宿主拒了却当写成了 = 界面在骗用户');
  assert.ok(T.storeNote().includes('没有这张皮肤'), T.storeNote());
  assert.ok(T.storeNote().includes('下次重启回到原样'), T.storeNote());
  const out = walk(ReactStub.createElement(CLIENT.AppearancePage, {}));
  assert.ok(out.texts.some((t) => t.includes('下次重启回到原样')), '这条坏消息必须画在界面上');
});

await checkA('ap-23 存档里有选择 → 开局照它恢复（皮肤套上、标志占上）；用户已经点过则不盖他的选择', async () => {
  resetRuntime();
  resetFetch();
  setFetch(async (url) => {
    if (url.endsWith('/prefs')) {
      return { ok: true, json: async () => ({ ok: true, data: { skinId: 'moss', brand: { mode: 'builtin', markId: 'hex' }, logoUrl: null, stored: true } }) };
    }
    return { ok: true, json: async () => ({ ok: true, data: {} }) };
  });
  const theme = makeStubTheme();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'conversation.hero.brand.mark']);
  entryCtx({ theme, slots });
  await T.loadPrefs();
  assert.equal(T.runtime.skinId, 'moss', `存档里的皮肤没恢复：${T.runtime.skinId}`);
  assert.equal(T.runtime.brand.markId, 'hex');
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'BrandMark', '存档说换过标志，图标位却还归官方');

  // 迟到的存档：用户在这期间自己点了"不覆盖"，存档不许再把他盖回去。
  resetRuntime();
  T.runtime.userChose = true;
  const theme2 = makeStubTheme();
  entryCtx({ theme: theme2 });
  theme2.calls.length = 0;
  await T.loadPrefs();
  assert.equal(theme2.calls.length, 0, '用户已经点过，迟到的存档还是套了一层');
});

check('ap-24 图片档只画 <img src>：用户挑的文件绝不进 innerHTML（SVG 里那段脚本就不会跑）', () => {
  resetRuntime();
  resetFetch();
  const url = `${ROUTE_PREFIX}/api/logo?v=1`;
  assert.equal(T.setBrand({ mode: 'image', imageUrl: url }), true);
  const node = ReactStub.createElement(T.BrandMark, { size: 24 });
  const rendered = walk(node);
  assert.ok(rendered.classes.includes('ap-mark-img'), `图片档没画出 img：${JSON.stringify(rendered)}`);
  // 断言形状：type 是 'img'，props 里只有 src/width/height/class/alt/draggable —— 没有 children、没有 innerHTML。
  const img = T.BrandMark({ size: 24 });
  assert.equal(img.type, 'img');
  assert.equal(img.props.src, url);
  assert.equal(img.props.children, undefined, 'img 带 children 就等于往里塞 HTML');
  assert.equal(Object.hasOwn(img.props, 'dangerouslySetInnerHTML'), false);
  // 内置那枚走 svg，不走 img。
  T.setBrand({ mode: 'builtin', markId: 'spark' });
  assert.equal(T.BrandMark({ size: 24 }).type, 'svg');
});

check('ap-25 未知档位与缺图片的 image 档都被拒，且当前注册不动（点错按钮不该把官方 logo 撤掉）', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'conversation.hero.brand.mark']);
  entryCtx({ slots });
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const before = T.runtime.brandRows.length;
  assert.equal(T.setBrand({ mode: 'sparkle' }), false);
  assert.equal(T.setBrand({ mode: 'builtin', markId: 'not-a-mark' }), false, '未知款式该拒（宿主那边也会拒，界面这边不该先动）');
  assert.equal(T.setBrand({ mode: 'image', imageUrl: '' }), false);
  assert.equal(T.runtime.brandRows.length, before, '被拒的档位却把注册撤了');
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'BrandMark');
  assert.equal(T.runtime.brand.mode, 'builtin');
});

check('ap-26 卸载把占过的格全撤掉：effect 收口之后官方 logo 回到渲染位', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'conversation.hero.brand.mark']);
  hostPayload();
  const disposers = [];
  const ctx = {
    slots,
    theme: makeStubTheme(),
    effects: [],
    effect(f, id) { this.effects.push(id); const d = f(); if (typeof d === 'function') disposers.push(d); return d; },
    inject(names, cb) { const face = {}; for (const n of names) face[n] = this[n]; cb(face); },
  };
  CLIENT.apply(ctx);
  T.setBrand({ mode: 'builtin', markId: 'drop' });
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'BrandMark');
  for (const d of disposers) d();
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'OfficialFill', '插件卸载了，图标位却没还给官方');
  assert.equal(slots.entriesOfSlot('conversation.hero.brand.mark')[0].component.name, 'OfficialFill');
  assert.equal(T.runtime.brandRows.length, 0);
});

check('ap-27 宿主没声明那两格图标位时：选择能存住、界面上写明"还没占上位"，不抛', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  hostPayload();
  const ctx = {
    slots,
    theme: makeStubTheme(),
    effect: (f) => f(),
    inject(names, cb) { cb({ theme: ctx.theme, slots }); },
  };
  slots.inject = (name) => { if (name === 'sidebar.panellist' || name === 'main') return; }; // 声明永远不来
  CLIENT.apply(ctx);
  assert.equal(T.runtime.brandDeclared.size, 0);
  assert.equal(T.setBrand({ mode: 'builtin', markId: 'ring' }), true);
  assert.equal(T.runtime.brandRows.length, 0, '没声明却硬注册，宿主会抛 "slot is not declared"');
  assert.match(T.brandSummary(), /还没占上位/, T.brandSummary());
});

/* ---- 2026-10-03 第三轮：用户对着真机截图提的四条界面问题 ---- */

/** CSS 串 → { 选择器: 声明体 }，给"排版类断言"用（这类问题只存在于样式串里）。 */
function cssRules() {
  const out = {};
  for (const line of T.CSS.split('\n')) {
    const i = line.indexOf('{');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1, -1).trim();
  }
  return out;
}
/** 一张卡片的最后一块（null 占位不算）。 */
const lastChild = (node) => (childOf(node) ?? []).flat().filter(Boolean).at(-1);
/** 按 `role` 找节点：单选方片的语义写在这个属性上，只按类名找就漏掉了"角色写错了"这类问题。 */
function findByRole(node, role, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findByRole(n, role, acc)); return acc; }
  if (typeof node.type === 'function') { findByRole(node.type(node.props ?? {}), role, acc); return acc; }
  if (node.props?.role === role) acc.push(node);
  const kids = node.children && node.children.length ? node.children : node.props?.children;
  if (kids !== undefined) findByRole(kids, role, acc);
  return acc;
}
/** 剥源码注释：解释性注释会先命中负向断言，把正确的写法判成错（本仓踩过两次）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');

check('ap-28 面板自己滚得动、卡片同级等高（用户报的"滚不动"与"按钮一个高一个低"）', () => {
  const rules = cssRules();
  assert.match(rules['.ap-root'], /overflow-y:auto/, '面板不自己滚，内容一长就被宿主主列裁掉（centerCol 是 overflow:hidden），用户根本看不到下面的区');
  assert.match(rules['.ap-root'], /height:100%/, '高度要跟宿主主列走；官方入口页 .fO69Vq_page 就是这么写的');
  assert.doesNotMatch(rules['.ap-root'], /100vh/, '100vh 把宿主顶带那条算进去了，尾巴会被裁掉一截 —— 用 height:100%');
  assert.match(rules['.ap-root'], /box-sizing:border-box/, 'box-sizing 必须写在根自己身上（`X *` 那种星号选择器盖不到 X 本身，宿主前端也没有通配重置）');
  assert.match(rules['.ap-root>*'], /flex:none/, '定高的 flex 列容器会把子项压缩着塞进去 —— 那样滚动条永远不出现');
  assert.match(rules['.ap-cards'], /align-items:stretch/, '卡片不等高，钉底也钉不齐');
  assert.match(rules['.ap-skin-foot'], /margin-top:auto/, '动作行没钉底：同一行卡片的"改 N 处配色"跟着文案行数一个高一个低');

  // 版式对不够，结构也要对：每张配色卡**自己**就是那一个单选项（整卡可点），
  // 卡里再嵌一个"用这张"按钮就等于一个选择两个入口 —— 用户点了哪个都说不清。
  const tree = CLIENT.AppearancePage({});
  const skinCards = (childOf(findByClass(tree, 'ap-cards')[0]) ?? []).flat();
  assert.equal(skinCards.length, SKINS.length + 1);
  for (const c of skinCards) {
    assert.equal(c.type, 'button', `配色卡不是可点的单选项：${c.type}`);
    assert.equal(c.props.role, 'radio');
    assert.equal(walk(c).buttons.length, 1, '卡里嵌了第二个按钮 = 一个选择两个入口');
    assert.equal(lastChild(c).props.className, 'ap-skin-foot', '卡片的动作行没钉在底部');
  }
  // 标志那一排：每枚自己就是单选项，卡里同样不许再嵌按钮。
  const tiles = findByRole(tree, 'radio').filter((n) => String(n.props.className).includes('ap-mark'));
  assert.equal(tiles.length, BRAND_MARKS.length + 1, `标志方片个数 = 原样 + 内置枚数，实得 ${tiles.length}`);
  for (const t of tiles) assert.equal(walk(t).buttons.length, 1, '标志方片里嵌了第二个按钮');
  // "你自己的图片"那格是 label 包着隐藏的 file input（整格点哪儿都开选择器），不是按钮。
  const upload = findByClass(tree, 'ap-mark ap-mark-upload');
  assert.equal(upload.length, 1, '图片那格找不到');
  assert.equal(upload[0].type, 'label');
  assert.equal(walk(upload[0]).buttons.length, 0);
});

check('ap-29 标志区排在配色区前面（用户 2026-10-03 点名要这个顺序）', () => {
  resetRuntime();
  resetFetch();
  entryCtx({ theme: makeStubTheme() });
  const tree = CLIENT.AppearancePage({});
  const heads = findByClass(tree, 'ap-sec-h').map((n) => childOf(n)[0]);
  assert.deepEqual(heads, ['标志', '配色'], `两个区的顺序或标题不对：${JSON.stringify(heads)}`);
  const classes = walk(tree).classes;
  const marks = classes.indexOf('ap-marks');
  const cards = classes.indexOf('ap-cards');
  assert.ok(marks >= 0 && cards >= 0, `两区的容器少了一个：marks=${marks} cards=${cards}`);
  assert.ok(marks < cards, `标志容器排在配色容器后面：marks=${marks} cards=${cards}`);
});

check('ap-30 每张配色卡片用那张皮肤自己的颜色画预览块（一眼看出点了会变成什么）', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme({ scheme: 'light' });
  entryCtx({ theme });
  const tree = CLIENT.AppearancePage({});
  const swatches = findByClass(tree, 'ap-swatch');
  assert.equal(swatches.length, SKINS.length + 1, `预览块个数对不上张数+不覆盖：${swatches.length}`);
  // 顺序 = 界面上真实的卡片顺序，**必须与宿主声明的 `skinChoices()` 一致**：这个顺序在两处各写了
  // 一遍（宿主那份是"声明"，client 这份是"界面实际画的"），谁漂了这条就红。
  // 「不覆盖」在首位（用户 2026-10-04 要求）—— 它是进来默认选中的那一项。
  const cardIds = walk(findByClass(tree, 'ap-cards')[0]).buttons.map((b) => b.props['data-ap-id']);
  assert.deepEqual(cardIds, skinChoices().map((c) => c.id), '配色卡顺序与 skinChoices() 声明的不一致（两处都要一起改）');
  assert.equal(cardIds[0], SKIN_NONE_ID, '「不覆盖」该排第一');
  const bgOf = (t) => t.map((s) => s.props.style.background);
  const bgs = bgOf(swatches);
  // 顺序 = skinChoices()：第 0 张是"不覆盖"，第 1..N 张才是各皮肤。
  assert.deepEqual(bgs.slice(1), SKINS.map((s) => s.tokens['--dsw-alias-bg-base'].light),
    '预览底色不是这张皮肤自己的底色');
  assert.equal(new Set(bgs.slice(1)).size, SKINS.length, '有几张预览底色撞色 = 八张看着一样，等于没预览');
  // 强调底（按钮那块）也要跟着这张皮肤，不然预览只报了个背景色。
  const chips = findByClass(tree, 'ap-sw-chip');
  assert.deepEqual(chips.map((c) => c.props.style.background),
    ['var(--dsw-alias-button-primary-fill, transparent)', ...SKINS.map((s) => s.tokens['--dsw-alias-button-primary-fill'].light)]);
  // "不覆盖"没有自己的颜色：让它读宿主当前配色，如实画出"现在长这样"。
  assert.match(bgs[0], /^var\(--dsw-alias-bg-base/, `不覆盖那张该读宿主令牌：${bgs[0]}`);

  // 明暗档：预览要跟界面当前那一档一致（切到暗档还画亮档，用户挑的就是错的那套）。
  theme.setScheme('dark');
  T.applySkin(theme, A_SKIN); // 套一层才有当前档读数
  assert.equal(T.runtime.scheme, 'dark');
  assert.deepEqual(bgOf(findByClass(CLIENT.AppearancePage({}), 'ap-swatch')).slice(1),
    SKINS.map((s) => s.tokens['--dsw-alias-bg-base'].dark), '界面在暗档，预览还画亮档');
});

/* ---- 2026-10-03 第四轮：用户"太丑了、交互不行"之后的重做 ---- */

check('ap-31 三态样式齐（悬停 / 焦点 / 选中），且一律读宿主令牌、根容器不许用容器查询', () => {
  const code = stripComments(T.CSS);
  assert.match(code, /\.ap-mark:hover:not\(\.ap-on\),\.ap-skin:hover:not\(\.ap-on\)\{[^}]*background:var\(--dsw-alias-/, '没有悬停态，鼠标划过去界面毫无反应（上一版通篇零 :hover）');
  assert.match(code, /\.ap-(mark|skin):focus-visible\{[^}]*outline:2px solid var\(--dsw-alias-/, '键盘走到这儿看不见焦点');
  const rules = cssRules();
  assert.match(rules['.ap-on'], /border-color:var\(--dsw-alias-brand-primary\)/, '选中态的描边不跟皮肤走');
  assert.match(rules['.ap-skin-foot'], /color:var\(--dsw-alias-/, '脚注文字色写死了');
  // container-type 会把整页塌成一列竖线（根容器宽度不再由内容撑开，宿主那层是 flex ⇒ 算成 0 宽）。
  assert.ok(!/container-type|@container/.test(code), '根容器不许用容器查询，断点一律 @media');
  assert.ok(!/position:fixed/.test(code), '面板里不许出现浮层');
});

check('ap-32 页头那行摘要就是操作的反馈落点（点了什么、成没成，都在原地看得见）', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  const textsOf = (n) => walk(n).texts.join(' ');
  const headDefault = findByClass(CLIENT.AppearancePage({}), 'ap-status')[0];
  assert.ok(headDefault, '页头没有状态摘要');
  assert.match(textsOf(headDefault), /不覆盖（内置配色）/, '默认态该写"配色：不覆盖"');
  assert.match(textsOf(headDefault), /原样（官方图标）/, '默认态该写"标志：原样"');

  T.applySkin(theme, A_SKIN);
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const headChosen = textsOf(findByClass(CLIENT.AppearancePage({}), 'ap-status')[0]);
  assert.match(headChosen, new RegExp(`${SKINS[0].name} · 24 处`), `点了皮肤却没在页头报出名字与处数：${headChosen}`);
  assert.match(headChosen, /内置 · 圆环 · 2 格/, `点了标志却没在页头报出占了几格：${headChosen}`);

  // 存档写失败：红字条要落在**页头块里**（不是页尾某张卡），用户才不用往下翻才知道没存住。
  T.runtime.storeNote = '这台机器上存不住 —— 重启后回到原样';
  const headErr = findByClass(CLIENT.AppearancePage({}), 'ap-head')[0];
  const notices = findByClass(headErr, 'ap-notices');
  assert.equal(notices.length, 1, '页头里没有承载错误的那块');
  assert.match(textsOf(notices[0]), /重启后回到原样/, '坏消息没画出来');
});

check('ap-33 切换选择不许重挂面板根容器（重挂会把滚动位置丢掉：点一下就跳回顶部）', () => {
  const raw = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const code = stripComments(raw);
  assert.ok(code.includes("h('div', { className: 'ap-root' },"), '面板根容器的写法变了，这条断言要跟着改');
  assert.ok(!/className: 'ap-root',\s*key:/.test(code),
    '根容器又挂上了 key —— 每点一次就整棵子树重挂，而它正是滚动容器，于是点一张皮肤页面就弹回顶部');
  // 这条断言只有在"根容器 = 滚动容器"时才有意义，所以把那一半也钉住，别让前半句悄悄失效。
  assert.match(cssRules()['.ap-root'], /overflow-y:auto/);
});

check('ap-34 没有死按钮：每个按钮都有 onClick 或被禁用；每个单选项都带 aria-checked 与键盘处理', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const tree = CLIENT.AppearancePage({});
  const out = walk(tree);
  assert.ok(out.buttons.length >= BRAND_MARKS.length + 1, `按钮收集得太少，这条等于没测：${out.buttons.length}`);
  const dead = out.buttons.filter((b) => typeof b.props.onClick !== 'function' && b.props.disabled !== true);
  assert.deepEqual(dead.map((b) => b.text), [], '这些按钮点了什么都不发生');
  const radios = findByRole(tree, 'radio');
  assert.ok(radios.length >= SKINS.length + 1 + BRAND_MARKS.length + 1, `单选项太少：${radios.length}`);
  for (const r of radios) {
    assert.ok(r.props['aria-checked'] === 'true' || r.props['aria-checked'] === 'false',
      `单选项没有 aria-checked：${JSON.stringify(r.props.className)}`);
    assert.equal(typeof r.props.onKeyDown, 'function', `单选项没有键盘处理：${JSON.stringify(r.props.className)}`);
  }
});

check('ap-35 一个选择只有一个入口，且任何时候组里恰好一项是选中的', () => {
  resetRuntime();
  resetFetch();
  const theme = makeStubTheme();
  entryCtx({ theme });
  T.applySkin(theme, A_SKIN);
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const tree = CLIENT.AppearancePage({});
  assert.equal(findByClass(tree, 'ap-cards').length, 1, '配色区不止一处（两个入口就会出现"我点的到底是哪个"）');
  assert.equal(findByClass(tree, 'ap-mark-radios').length, 1, '标志的单项组不止一处');

  const picked = (role, cls) => findByRole(tree, role).filter((n) => String(n.props.className).includes(cls) && n.props['aria-checked'] === 'true');
  const skinPicked = picked('radio', 'ap-skin');
  assert.equal(skinPicked.length, 1, `配色组里选中的有 ${skinPicked.length} 张（单选语义：恰好一张）`);
  assert.equal(skinPicked[0].props['data-ap-id'], A_SKIN, '选中的那张不是当前生效的这张');
  const markPicked = picked('radio', 'ap-mark');
  assert.equal(markPicked.length, 1, `标志组里选中的有 ${markPicked.length} 枚`);
  assert.equal(markPicked[0].props['data-ap-id'], 'ring');
  // 方向键真的会挪：从第 0 枚往右一格，落到第 1 枚（顺序 = 视觉顺序）。
  const ids = ['off', ...BRAND_MARKS.map((m) => m.id)];
  const sent = [];
  T.radioKeys({ key: 'ArrowRight', preventDefault() {} }, ids, 'off', (id) => sent.push(id));
  assert.deepEqual(sent, [ids[1]], `方向键没在组内移动：${JSON.stringify(sent)}`);
  T.radioKeys({ key: 'ArrowDown', preventDefault() {} }, ids, ids.at(-1), (id) => sent.push(id));
  assert.equal(sent.at(-1), 'off', '方向键到末尾没有绕回开头');
});

/* ---- 2026-10-04 第五轮：名称行可换 + 图片自动裁切压缩 ---- */

check('ap-36 名称行：填了字才占那一格、清空就还给官方，且与图标档位互不牵连', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  const officialOf = (n) => slots.entriesOfSlot(n)[0].component.name;
  entryCtx({ slots });

  // 默认：三格都还是官方的。
  assert.equal(officialOf('sidebar.brand.name'), 'OfficialFill', '没填字就占了名称行 —— 用户要的是进来原样');

  // 只填名字、图标保持原样：合法组合（两件事各自独立）。
  assert.deepEqual(T.setBrandName('我的工作台'), { ok: true });
  assert.equal(officialOf('sidebar.brand.name'), 'NameSlot', '填了名字却没占上名称行');
  assert.equal(officialOf('sidebar.brand.mark'), 'OfficialFill', '"只改名字"却把官方图标挤下去了');
  assert.equal(T.runtime.brand.name, '我的工作台');

  // 前后空白削掉：输入框里多敲的空格不该进库。
  T.setBrandName('  留白  ');
  assert.equal(T.runtime.brand.name, '留白');

  // 超长：拒，且**现状一个字节都不许动**（不能"拒了，但那一格已经改了"）。
  const tooLong = T.setBrandName('x'.repeat(BRAND_NAME_MAX + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.reason, new RegExp(String(BRAND_NAME_MAX)), `报错要说清上限：${tooLong.reason}`);
  assert.equal(T.runtime.brand.name, '留白', '超长被拒了，那一格却已经改了');

  // 清空 = 把那一格还给官方（不是换成空字符串）。
  assert.deepEqual(T.setBrandName('   '), { ok: true });
  assert.equal(T.runtime.brand.name, null);
  assert.equal(officialOf('sidebar.brand.name'), 'OfficialFill', '清空后名称行没还给官方');

  // 换图标不许把名字一起抹掉。
  T.setBrandName('别动我');
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  assert.equal(T.runtime.brand.name, '别动我', '换图标时把名称行一起清了');
  assert.equal(officialOf('sidebar.brand.name'), 'NameSlot');

  // 图标挑回原样：图标位还给官方，名称行**留着**（两件事互不牵连）。
  T.setBrand({ mode: 'off' });
  assert.equal(officialOf('sidebar.brand.mark'), 'OfficialFill');
  assert.equal(officialOf('sidebar.brand.name'), 'NameSlot', '"图标挑回原样"把名称行也撤了');
  assert.equal(T.runtime.brand.name, '别动我');
});

check('ap-37 居中 cover 的裁切几何：横图切左右、竖图切上下、方图一个像素都不动', () => {
  assert.deepEqual(T.coverRect(1200, 800), { x: 200, y: 0, s: 800 }, '横图：短边是全高，长边两边各切 200');
  assert.deepEqual(T.coverRect(800, 1200), { x: 0, y: 200, s: 800 }, '竖图：短边是全宽，长边两边各切 200');
  assert.deepEqual(T.coverRect(400, 400), { x: 0, y: 0, s: 400 }, '方图不该被裁');
  assert.deepEqual(T.coverRect(999, 500), { x: 250, y: 0, s: 500 }, '奇数差要落到整数像素上（半个像素画不出来）');
});

/**
 * canvas / 位图 / FileReader 的最小桩：只回答 shrinkImage 会问的那几件事。
 * `kbPerQuality` 是"质量 1.0 时的基准字节"，据此能算出阶梯在第几档进入 200KB
 * —— 让"压缩过程"在离线也可断言，而不是只靠真机肉眼看。
 */
function withImageEnv({ width = 1200, height = 800, alpha = false, kbPerQuality = 300 } = {}, fn) {
  const saved = { bmp: globalThis.createImageBitmap, fr: globalThis.FileReader, doc: globalThis.document };
  const calls = { draw: [], toBlob: [], canvases: 0 };
  globalThis.createImageBitmap = async () => ({ width, height, close() {} });
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      this.result = `data:${String(blob?.type ?? '')};base64,AAAA`;
      if (this.onload) this.onload();
    }
  };
  globalThis.document = {
    ...saved.doc,
    createElement: () => {
      calls.canvases += 1;
      return {
        width: 0, height: 0,
        getContext: () => ({
          drawImage: (_img, sx, sy, sw, sh, _dx, _dy, dw, dh) => calls.draw.push({ sx, sy, sw, sh, dw, dh }),
          getImageData: (_x, _y, w, h) => ({ data: new Uint8Array(w * h * 4).fill(alpha ? 100 : 255) }),
        }),
        toBlob: (cb, mime, q) => {
          calls.toBlob.push({ mime, q });
          cb({ size: Math.round(kbPerQuality * 1024 * q * (mime === 'image/webp' ? 0.8 : 1)), type: mime });
        },
      };
    },
  };
  const restore = () => {
    if (saved.bmp === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = saved.bmp;
    if (saved.fr === undefined) delete globalThis.FileReader; else globalThis.FileReader = saved.fr;
    globalThis.document = saved.doc;
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(restore);
}

await checkA('ap-38 长方形透明图：裁成方形 + 走 WebP + 沿质量阶梯压到 200KB 以内，并把过程说给用户听', async () => {
  resetRuntime();
  await withImageEnv({ width: 1200, height: 800, alpha: true, kbPerQuality: 300 }, async (calls) => {
    const out = await T.shrinkImage({ type: 'image/png', size: 3 * 1024 * 1024 });
    assert.equal(out.mime, 'image/webp', '有透明的图走 JPEG，透明区会被糊成黑底');
    assert.ok(String(out.dataUrl).startsWith('data:image/webp;base64,'), String(out.dataUrl).slice(0, 40));
    assert.ok(out.bytes <= T.LOGO_MAX_BYTES, `处理完还有 ${out.bytes} 字节，仍超过上限`);
    assert.match(out.note, /已裁成方形/, `没告诉用户裁过了：${out.note}`);
    assert.match(out.note, /压到/, `没告诉用户压了多少：${out.note}`);
    // 画进 canvas 的源矩形必须正好是居中裁出来那块，成品 512×512（原图短边 800 > 512）。
    assert.deepEqual(calls.draw[0], { sx: 200, sy: 0, sw: 800, sh: 800, dw: 512, dh: 512 });
    // 阶梯：300KB 基准 × webp 0.8 ⇒ 0.92→220KB 超线、0.84→201KB 还超、0.75→180KB 进线。
    assert.deepEqual(calls.toBlob.map((c) => c.q), [0.92, 0.84, 0.75], `质量阶梯走错了：${JSON.stringify(calls.toBlob)}`);
    assert.ok(calls.toBlob.every((c) => c.mime === 'image/webp'), '阶梯中途换了格式');
  });
});

await checkA('ap-39 不透明的图走 JPEG；方形小图压完反而更大 ⇒ 回退用原文件，不做无谓的重编码', async () => {
  await withImageEnv({ width: 600, height: 600, alpha: false, kbPerQuality: 300 }, async (calls) => {
    const file = { type: 'image/jpeg', size: 40 * 1024 };
    const out = await T.shrinkImage(file);
    assert.equal(out.mime, 'image/jpeg', '不透明的图该走 JPEG（兼容最好）');
    assert.equal(calls.toBlob[0].mime, 'image/jpeg');
    assert.equal(out.bytes, file.size, '压完比原图还大，却没用原文件（白做一次有损重编码）');
    assert.match(out.note, /原样保留/, out.note);
  });
});

await checkA('ap-40 SVG 不位图化：矢量原样直送，一个 canvas 都不建', async () => {
  await withImageEnv({}, async (calls) => {
    const out = await T.shrinkImage({ type: 'image/svg+xml', size: 4 * 1024 });
    assert.equal(out.mime, 'image/svg+xml');
    assert.ok(String(out.dataUrl).startsWith('data:image/svg+xml;base64,'), String(out.dataUrl).slice(0, 40));
    assert.equal(calls.canvases, 0, 'SVG 被位图化了 —— 矢量放大本来就清晰，位图化只会把它弄糊');
    assert.match(out.note, /矢量图原样保留/);
  });
});

await checkA('ap-41 处理之前的原图上限：超过 10MB 直接拒，一个请求都不发（解码巨图会冻住界面）', async () => {
  resetRuntime();
  resetFetch();
  let err = null;
  await T.uploadImage({ type: 'image/png', size: 11 * 1024 * 1024 }, 'mark', (e) => { err = e; });
  assert.ok(err && /超过/.test(err), `超限没给出人话：${err}`);
  assert.equal(fetchCalls.length, 0, '明知超限还把图送去上传');
  // 不是图片的也当场拒。
  err = null;
  await T.uploadImage({ type: 'text/html', size: 100 }, 'mark', (e) => { err = e; });
  assert.ok(err && /不是图片/.test(err), `非图片类型没拦住：${err}`);
  assert.equal(fetchCalls.length, 0);
  // 两格共用同一条闸：名称行那一路也不许例外（宿主的重验更严，这里松了等于白拦）
  err = null;
  await T.uploadImage({ type: 'image/png', size: 11 * 1024 * 1024 }, 'name', (e) => { err = e; });
  assert.ok(err && /超过/.test(err), `名称行那一路没拦住超限：${err}`);
  // 落点写错（不是那两格之一）当场拒，不静默当成 mark 存去图标位。
  err = null;
  await T.uploadImage({ type: 'image/png', size: 100 }, 'hero', (e) => { err = e; });
  assert.ok(err && /哪一格/.test(err), `落点不明却没拦住：${err}`);
  assert.equal(fetchCalls.length, 0);
});

check('ap-42 换一枚标志必须重新占位：宿主只在注册表变化时才重画，光改我们这边的状态侧栏不会动', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  entryCtx({ slots });
  const regs = (n) => slots.log.filter((l) => l.phase === 'register' && l.name === n).length;
  const unregs = (n) => slots.log.filter((l) => l.phase === 'unregister' && l.name === n).length;

  const base = regs('sidebar.brand.mark'); // 官方品牌包那一次（它也记日志）
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  assert.equal(regs('sidebar.brand.mark'), base + 1, '第一枚没占上');
  assert.equal(slots.entriesOfSlot('sidebar.brand.mark')[0].component.name, 'BrandMark');

  // 用户 2026-10-04 报的「点了一枚，再点另一枚就不生效」：就是这里注册表没有真的动过。
  T.setBrand({ mode: 'builtin', markId: 'diamond' });
  assert.equal(T.runtime.brand.markId, 'diamond', '档位没换过去');
  assert.equal(regs('sidebar.brand.mark'), base + 2, '换了标志却没重新占位 —— 宿主不会知道要重画，侧栏会停在上一枚');
  assert.equal(unregs('sidebar.brand.mark'), 1, '旧的注册没撤掉（同一格同档位再注册会直接抛）');

  // 同一枚点第二次：指纹没变，不该白重挂一遍。
  T.setBrand({ mode: 'builtin', markId: 'diamond' });
  assert.equal(regs('sidebar.brand.mark'), base + 2, '重复点同一枚，却把注册表又动了一遍');
});

check('ap-43 指纹的粒度：改名称行只重挂那一格，图标位一个字节都不动（不重挂 = 官方 logo 不闪回）', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  entryCtx({ slots });
  const regs = (n) => slots.log.filter((l) => l.phase === 'register' && l.name === n).length;

  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const markRegs = regs('sidebar.brand.mark');
  const nameRegs = regs('sidebar.brand.name');

  T.setBrandName('我的工作台');
  assert.equal(regs('sidebar.brand.mark'), markRegs, '只改名字却把图标位重挂了（那一瞬官方 logo 会闪回来）');
  assert.equal(regs('sidebar.brand.name'), nameRegs + 1, '名称行没占上');

  // 名字再改一次：指纹变了 ⇒ 必须重挂，否则侧栏那行字不会更新（跟图标同一个道理）。
  T.setBrandName('换个名字');
  assert.equal(regs('sidebar.brand.name'), nameRegs + 2, '名字改了却没重新占位 —— 侧栏那行字不会变');
  assert.equal(regs('sidebar.brand.mark'), markRegs, '改名字连累了图标位');
});

check('ap-44 方片下面那句必须把支持的格式列出来，而且清单与白名单同源（不许手写一遍）', () => {
  resetRuntime();
  resetFetch();
  hostPayload();
  entryCtx({ slots: makeStubSlots() });
  const out = walk(ReactStub.createElement(CLIENT.AppearancePage, {}));
  const note = out.texts.find((t) => t.includes('支持的图片'));
  assert.ok(note, `方片下面没说支持哪些格式：${JSON.stringify(out.texts.slice(0, 20))}`);
  for (const [mime, label] of Object.entries(T.LOGO_MIME_LABELS)) {
    assert.ok(note.includes(label), `白名单里有 ${mime}，文案里却没写出 ${label}：${note}`);
  }
  assert.ok(T.LOGO_ALLOWED_MIMES.every((m) => T.LOGO_MIME_LABELS[m]), '白名单里有人没给显示名，文案会漏掉它');
  // 老的那句"自己的图片：…"里从没提过格式，是用户 2026-10-04 点名要补的。
  assert.ok(!out.texts.some((t) => t.startsWith('自己的图片：')), '旧文案还在：格式清单没进去');
});

/* ------------------------------------------------------------------
 * 第六轮：名称行那一格也能换成图片（用户 2026-10-04 的第二条要求）
 * + 那行"处理成什么样了"跟着当前状态走（同一天他报的第一条）
 * ------------------------------------------------------------------ */

check('ap-45 名称行画什么由**来源**决定（不是"谁非空就画谁"）：选文字就画字、选图片才画图、官方就还给官方', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  entryCtx({ slots });
  const occupant = () => slots.entriesOfSlot('sidebar.brand.name')[0]?.component.name;

  // 只填了字：那一格占上、画 <span>。
  T.setBrandName('奋进的个人工作台');
  assert.equal(occupant(), 'NameSlot');
  assert.equal(T.NameSlot().type, 'span');
  assert.equal(T.NameSlot().props.className, 'ap-brandname');

  // 再选图：那一格改画 <img>，但**文字一个字节都不许丢**（换来源 ≠ 把另一份内容删了）。
  T.setBrandNameImage('/appearance/api/logo?which=name&v=3');
  const img = T.NameSlot();
  assert.equal(img.type, 'img', '选了图片那一格该画图');
  assert.equal(img.props.src, '/appearance/api/logo?which=name&v=3');
  assert.equal(img.props.className, 'ap-brandimg');
  assert.equal(T.runtime.brand.name, '奋进的个人工作台', '换图把用户填的文字吃掉了 —— 那他清掉图之后回不来');
  assert.equal(img.props.alt, '奋进的个人工作台', '图加载不出来时要有个交代（读屏与断链都靠 alt）');
  assert.equal(T.nameArt(), 'image');

  /*
   * 下拉带来的**新**语义，也是它相对"图片优先"唯一的实质差别：
   * 库里那张图还在，但用户把来源选回了「自定义文字」⇒ 这一格必须画字，不许自作主张继续画图。
   * （"有图就画图"那条老口径在这里会直接失败 —— 而那样用户的选择就成了摆设。）
   */
  assert.equal(T.setBrandNameSource('text'), true);
  assert.equal(T.runtime.brand.nameImageUrl, '/appearance/api/logo?which=name&v=3',
    '切到文字就把图丢了 —— 用户切回图片时还得重选一张');
  assert.equal(T.NameSlot().type, 'span', '来源选了"文字"，那一格却还在画图');
  assert.equal(T.nameArt(), 'text');
  // 切回图片：地址还在 ⇒ 立刻又画得上，不用重选。
  T.setBrandNameSource('image');
  assert.equal(T.NameSlot().type, 'img', '切回"图片"却没画回原来那张');
  assert.equal(T.nameArt(), 'image');

  // 切到"官方字标"：两头都清（这一项就是原来的「还原官方」），那一格还给官方。
  T.setBrandNameSource('off');
  assert.equal(T.nameArt(), null);
  assert.equal(T.runtime.brand.name, null, '选官方字标没清掉文字');
  assert.equal(T.runtime.brand.nameImageUrl, null, '选官方字标留下了图片地址');
  assert.equal(T.desiredBrandSlots().has(T.BRAND_NAME_SLOT), false, '那一格什么都没有却还占着');
  assert.equal(T.NameSlot(), null);
  assert.equal(occupant(), 'OfficialFill', '名称行还给官方之后，渲染的该是官方那条');

  // 不认识的来源当场拒，且**不许**顺手改成某一项（静默回落 = 用户以为切换成功了）。
  T.setBrandName('还在');
  assert.equal(T.setBrandNameSource('hero'), false, '不认识的来源被收下了');
  assert.equal(T.runtime.brand.nameMode, 'text');
  assert.equal(T.runtime.brand.name, '还在', '拒掉一个非法来源却把那一格清了');
});

check('ap-45b 选了"自定义图片"但还没选到图：降级画文字（没文字就还给官方），不许把那一格留空', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.name', 'conversation.hero.brand.mark']);
  entryCtx({ slots });

  // 有文字、选了图片、图还没来 ⇒ 降级画那段字（那一格空着会被宿主当成"没占位"，用户看到闪一下）。
  T.setBrandName('我的工作台');
  T.setBrandNameSource('image');
  assert.equal(T.runtime.brand.nameMode, 'image', '来源该停在"图片"上（那就是用户刚做的选择）');
  assert.equal(T.runtime.brand.nameImageUrl, null);
  assert.equal(T.nameArt(), 'text', '还没图就把那一格留空了');
  assert.equal(T.NameSlot().props.children, '我的工作台');

  // 连文字也没有 ⇒ 那一格还给官方（不占位、不画一个空壳）。
  T.setBrandName(null);
  assert.equal(T.runtime.brand.nameMode, 'image', '清文字把来源也改了 —— 用户分明还等着选图呢');
  assert.equal(T.nameArt(), null);
  assert.equal(T.desiredBrandSlots().has(T.BRAND_NAME_SLOT), false, '什么都没有却还占着那一格');
  assert.equal(slots.entriesOfSlot('sidebar.brand.name')[0].component.name, 'OfficialFill');
});

check('ap-46 名称行图的两个边界：换图必须重挂那一格；图在时改文字不许重挂（重挂 = 图白闪一次）', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']);
  entryCtx({ slots });
  const regs = (n) => slots.log.filter((l) => l.phase === 'register' && l.name === n).length;

  T.setBrand({ mode: 'builtin', markId: 'ring' });
  const markRegs = regs('sidebar.brand.mark');
  T.setBrandName('A');
  const textRegs = regs('sidebar.brand.name');

  // 换上图：那一格画的东西换了 ⇒ 必须重挂，否则侧栏还是旧样子（宿主只在注册表变化时重画）。
  T.setBrandNameImage('/x?v=1');
  assert.equal(regs('sidebar.brand.name'), textRegs + 1, '换上图没重挂 —— 侧栏不会变');
  // 改文字：图在时那一格画的还是图，指纹不该动。
  T.setBrandName('B');
  assert.equal(T.runtime.brand.name, 'B', '文字没落进去（清掉图之后要回到它）');
  assert.equal(regs('sidebar.brand.name'), textRegs + 1, '图在时改文字把那一格重挂了 —— 图片会重新请求一次，用户看得见一次闪');
  // 换一张图：指纹里带地址 ⇒ 必须重挂。
  T.setBrandNameImage('/x?v=2');
  assert.equal(regs('sidebar.brand.name'), textRegs + 2, '换了张图却没重挂 —— 侧栏还是上一张');
  // 清掉图：那一格从图切回文字，也要重挂（这时文字才画得出来）。
  T.setBrandNameImage(null);
  assert.equal(regs('sidebar.brand.name'), textRegs + 3, '清掉图却没重挂 —— 文字回不来');
  assert.equal(T.NameSlot().props.children, 'B');

  assert.equal(regs('sidebar.brand.mark'), markRegs, '名称行的动静连累了图标位（官方 logo 会白闪）');
});

await checkA('ap-47 两格共用同一条编码链，只有"裁不裁、框多大"不同：名称行不裁方、按原比例缩进 512×160', async () => {
  // 一横长条：图标位裁成方，名称行原封不动按比例缩。
  await withImageEnv({ width: 2400, height: 600, alpha: false, kbPerQuality: 300 }, async (calls) => {
    const file = { type: 'image/jpeg', size: 900 * 1024 };
    const mark = await T.shrinkImage(file, 'mark');
    assert.deepEqual(calls.draw[0], { sx: 900, sy: 0, sw: 600, sh: 600, dw: 512, dh: 512 },
      `图标位该居中裁成方：${JSON.stringify(calls.draw[0])}`);
    assert.match(mark.note, /已裁成方形/, mark.note);

    calls.draw.length = 0;
    const name = await T.shrinkImage(file, 'name');
    assert.deepEqual(calls.draw[0], { sx: 0, sy: 0, sw: 2400, sh: 600, dw: 512, dh: 128 },
      `名称行那张不许裁、按原比例缩：${JSON.stringify(calls.draw[0])}`);
    assert.match(name.note, /按原比例缩到 512×128/, `该告诉用户缩成了多大：${name.note}`);
    assert.ok(!/已裁成方形/.test(name.note), '名称行那张被裁了 —— 横向字标裁成方只剩中间一小块');
    // 编码那半段两格完全一样：格式由"有没有透明"决定，与落在哪一格无关。
    assert.equal(name.mime, mark.mime, '两格的编码格式口径分叉了');
  });
  // 方图丢进名称行：被**高**那个上限挡住（160），不是按宽缩到 512。
  await withImageEnv({ width: 4000, height: 4000, alpha: false, kbPerQuality: 300 }, async (calls) => {
    await T.shrinkImage({ type: 'image/jpeg', size: 900 * 1024 }, 'name');
    assert.deepEqual(calls.draw[0], { sx: 0, sy: 0, sw: 4000, sh: 4000, dw: 160, dh: 160 },
      `名称行那张该被 160 那个上限挡住：${JSON.stringify(calls.draw[0])}`);
  });
  // 名称行那张本来就在框里 ⇒ 一个像素都不动（不放大，也不白重编码）。
  await withImageEnv({ width: 200, height: 40, alpha: false, kbPerQuality: 300 }, async (calls) => {
    const out = await T.shrinkImage({ type: 'image/jpeg', size: 8 * 1024 }, 'name');
    assert.deepEqual(calls.draw[0], { sx: 0, sy: 0, sw: 200, sh: 40, dw: 200, dh: 40 },
      `小图被缩放了：${JSON.stringify(calls.draw[0])}`);
    assert.equal(out.bytes, 8 * 1024, '压完更大、原图又合规，却没回退用原文件');
  });
});

check('ap-48 那行"处理成什么样了"跟着当前状态走：切回内置图标 / 清掉图片它就消失（用户报的一直挂着）', () => {
  resetRuntime();
  resetFetch();
  const markNote = { text: '已裁成方形 · 从 3284KB 压到 77KB', target: 'mark' };
  const nameNote = { text: '按原比例缩到 512×128', target: 'name' };

  // 图刚存上、那一格正用着它 ⇒ 显示。
  T.setBrand({ mode: 'image', imageUrl: '/logo?v=1' });
  assert.equal(T.noteVisible(markNote, 'mark'), true, '图在用却不显示，用户就没法确认处理成什么样了');
  // 切成内置款式 ⇒ 那句已经没有对象了。
  T.setBrand({ mode: 'builtin', markId: 'spark' });
  assert.equal(T.noteVisible(markNote, 'mark'), false, '切回内置图标后那行还在 —— 用户 2026-10-04 报的正是这个');
  // 切回"原样"也一样。
  T.setBrand({ mode: 'off' });
  assert.equal(T.noteVisible(markNote, 'mark'), false, '切回原样后那行还挂着');

  // 名称行同理，判据是"那一格真的挂着图"。
  assert.equal(T.noteVisible(nameNote, 'name'), false, '名称行还没图，却显示上一次的结果');
  T.setBrandNameImage('/logo?which=name&v=2');
  assert.equal(T.noteVisible(nameNote, 'name'), true, '名称行那张图刚存上，结果却不显示');
  T.setBrandNameImage(null);
  assert.equal(T.noteVisible(nameNote, 'name'), false, '清掉图片后那行还在');

  /*
   * 下拉带来的新路径：图**还在库里**，只是这一格换成了别的来源（"自定义文字"/"官方字标"）。
   * 判据必须是"这一格在不在画那张图"，不能是"库里有没有图" —— 否则用户切到文字之后，
   * 那句"从 3284KB 压到 77KB"还挂着，说的却是一张现在根本没在用的图（用户报的就是这个形状）。
   */
  T.setBrandName('我的工作台');
  T.setBrandNameImage('/logo?which=name&v=4');
  assert.equal(T.noteVisible(nameNote, 'name'), true);
  T.setBrandNameSource('text');
  assert.equal(T.runtime.brand.nameImageUrl, '/logo?which=name&v=4', '切来源把地址清了 —— 这条就测了个空');
  assert.equal(T.noteVisible(nameNote, 'name'), false, '切到"自定义文字"之后那行处理结果还挂着');
  T.setBrandNameSource('image');
  assert.equal(T.noteVisible(nameNote, 'name'), true, '切回图片那行结果该回来');
  T.clearNameArt();
  assert.equal(T.noteVisible(nameNote, 'name'), false, '选官方字标之后那行还在');

  // 两格的提示不许串线：名称行那张的结果不该出现在图标位那格上（反之亦然）。
  assert.equal(T.noteVisible(nameNote, 'mark'), false, '名称行的结果跑到图标位那格去了');
  T.setBrand({ mode: 'image', imageUrl: '/logo?v=3' });
  assert.equal(T.noteVisible(markNote, 'name'), false, '图标位那行的结果串到名称行去了');
  // 没有结果时不许崩、也不许显示。
  assert.equal(T.noteVisible(null, 'mark'), false);
  assert.equal(T.noteVisible(undefined, 'name'), false);
});

check('ap-49 名称行的两个清法不一样：清掉图片只清图（文字留着）；还原官方两头都清', () => {
  resetRuntime();
  resetFetch();
  const slots = makeStubSlots();
  slots.occupyOfficialBrand(['sidebar.brand.name', 'sidebar.brand.mark']);
  entryCtx({ slots });
  const occupant = () => slots.entriesOfSlot('sidebar.brand.name')[0]?.component.name;

  T.setBrandName('我的工作台');
  T.setBrandNameImage('/logo?which=name&v=4');
  assert.equal(occupant(), 'NameSlot');

  // 只清图片：文字必须还在 —— 用户清完图看到的应该是他填的那段字。
  // 来源也跟着从"图片"退回"文字"（不能停在"图片"上：下拉显示图片、那一格却画着字，自相矛盾）。
  T.setBrandNameImage(null);
  assert.equal(T.runtime.brand.name, '我的工作台', '清图片把文字也清了');
  assert.equal(T.runtime.brand.nameMode, 'text', '清掉图之后来源没退回文字');
  assert.equal(T.NameSlot().props.children, '我的工作台');

  // 还原官方（= 下拉选「官方字标」）：两头一起清，那一格还给官方。
  T.setBrandNameImage('/logo?which=name&v=5');
  T.clearNameArt();
  assert.equal(T.runtime.brand.name, null, '选官方字标没清掉文字');
  assert.equal(T.runtime.brand.nameImageUrl, null, '选官方字标留下了图片 —— 那一格会继续画图，用户看到的是"按了没反应"');
  assert.equal(T.runtime.brand.nameMode, 'off');
  assert.equal(T.nameArt(), null);
  assert.equal(occupant(), 'OfficialFill', '选官方字标之后渲染的还是我们的 NameSlot');

  // 反过来也一样：只有图、没文字时，"官方字标"不许因为"文字是空的"就跳过清理。
  T.setBrandNameImage('/logo?which=name&v=6');
  T.clearNameArt();
  assert.equal(T.runtime.brand.nameImageUrl, null);
  assert.equal(occupant(), 'OfficialFill');

  // 清图片时**没文字**：来源该一路退到"官方字标"（而不是停在"文字"上，那一项此刻没有任何内容）。
  T.setBrandNameImage('/logo?which=name&v=7');
  T.setBrandNameImage(null);
  assert.equal(T.runtime.brand.nameMode, 'off');
  assert.equal(occupant(), 'OfficialFill');
});

await checkA('ap-50 写通道的边界：某格我们还没读到、用户也没动过，就不带它（点一枚标志不许抹掉存档里的名字）', async () => {
  resetRuntime();
  resetFetch();
  hostPayload();
  const lastBrand = () => JSON.parse(fetchCalls.find((c) => c.url.endsWith('/prefs')).init.body).brand;

  // 存档还在路上、用户什么都没动 ⇒ 一个字段都不带。
  // 宿主的写是**整份覆盖**，多带一个默认值就等于把用户上次存的东西抹掉。
  await T.persistBrand();
  assert.deepEqual(lastBrand(), {}, `存档还没回来就不该拿我们这边的默认值去覆盖：${JSON.stringify(lastBrand())}`);

  // 只点了标志 ⇒ 只写档位那两个字段；名称行的字段一个都不带（它们的值我们还不知道）。
  resetFetch();
  T.runtime.markTouched = true;
  T.setBrand({ mode: 'builtin', markId: 'ring' });
  await T.persistBrand();
  assert.deepEqual(Object.keys(lastBrand()).sort(), ['markId', 'mode'], JSON.stringify(lastBrand()));
  assert.equal(lastBrand().mode, 'builtin');

  // 用户填了名字 ⇒ 文字那一个字段跟着上来；图片开关仍然不带（那一样他还没动过）。
  resetFetch();
  T.setBrandName('别动我');
  T.runtime.nameTouched = true;
  await T.persistBrand();
  assert.equal(lastBrand().name, '别动我');
  assert.equal(Object.hasOwn(lastBrand(), 'nameImage'), false, '没动过图片开关却把它带上来了');

  // 存档回来了（bootLoaded）⇒ 三个字段都是我们知道的真值，照写。
  resetRuntime();
  resetFetch();
  T.runtime.bootLoaded = true;
  T.setBrandNameImage('/logo?which=name&v=5');
  await T.persistBrand();
  assert.equal(lastBrand().nameImage, true, '名称行挂着图，写存档时却报了"不用图" —— 重启后那张图就没了');
  assert.equal(lastBrand().mode, 'off');
  assert.equal(lastBrand().name, null);
});

check('ap-51 名称行是个**来源下拉**：三个选项各带一组操作，一次只出现一组；窄面板整组换行', () => {
  resetRuntime();
  resetFetch();
  hostPayload();
  entryCtx({ slots: makeStubSlots() });
  const tree = () => ReactStub.createElement(CLIENT.AppearancePage, {});
  const selOf = (t) => findByProp(t, 'data-ap-id', 'name-src')[0];

  // 默认态（官方字标）：下拉在位、三项齐全、当前值就是"官方"，右边**一个操作控件都没有**。
  let t0 = tree();
  const sel = selOf(t0);
  assert(sel, `名称行的来源下拉不见了：${JSON.stringify(walk(t0).classes)}`);
  assert.equal(sel.type, 'select', `来源入口该是 select，实际是 ${sel.type}`);
  assert.deepEqual(sel.props.children.map((o) => o.props.value), T.NAME_SRC_LIST,
    '下拉的选项与 NAME_SRC_LIST 不同源（增删一项时界面会漂）');
  assert.deepEqual(sel.props.children.map((o) => o.props.children), ['官方字标', '自定义文字', '自定义图片'],
    `三个选项写给用户看的话不是这三句：${JSON.stringify(sel.props.children.map((o) => o.props.children))}`);
  assert.equal(sel.props.value, 'off', '默认该停在"官方字标"上');
  assert.equal(sel.props.disabled, false, '默认就把下拉禁掉了');
  assert.ok(!findByProp(t0, 'data-ap-id', 'name-apply').length, '停在"官方字标"却冒出了文字那组的「用这个」');
  assert.ok(!findByProp(t0, 'data-ap-id', 'name-image').length, '停在"官方字标"却冒出了图片那组的入口');
  assert.ok(!findByProp(t0, 'data-ap-id', 'name-image-clear').length, '没有图却冒出"清掉图片"');
  assert.ok(walk(t0).texts.some((x) => x.includes('dsh 自带的字标')), `"官方字标"这一项没就地说明：${JSON.stringify(walk(t0).texts)}`);

  // 选「自定义文字」：换成文字那组（输入框 + 用这个），图片那组整组撤掉。
  T.setBrandNameSource('text');
  let t1 = tree();
  assert.equal(selOf(t1).props.value, 'text');
  assert.ok(findByProp(t1, 'data-ap-id', 'name-apply').length, '选了"自定义文字"却没出现「用这个」');
  assert.ok(!findByProp(t1, 'data-ap-id', 'name-image').length, '两组操作同时出现了 —— 一次只该有一组');
  assert.equal(findByClass(t1, 'ap-name-i').length, 1, '文字输入框不在');

  // 选「自定义图片」：换成图片那组。它是个 `<label>`（整块可点 → 开文件选择器），不是 button。
  T.setBrandNameSource('image');
  let t2 = tree();
  assert.equal(selOf(t2).props.value, 'image');
  assert.ok(!findByProp(t2, 'data-ap-id', 'name-apply').length, '选了"自定义图片"却没把文字那组撤掉');
  let picks = findByProp(t2, 'data-ap-id', 'name-image');
  assert.equal(picks.length, 1, `名称行的"选图片"入口不见了：${picks.length}`);
  assert.equal(picks[0].type, 'label', '图片入口该是 label（包着隐藏 input），不是按钮');
  const pickCls = String(picks[0].props.className);
  assert.ok(pickCls.includes('ap-name-b') && pickCls.includes('ap-name-pick'),
    `图片入口没借用按钮的皮（看着不像能点的）：${pickCls}`);
  // 两格各要一个隐藏的 file input（图标位那格 + 名称行那格），少一个就有一格选不了文件。
  assert.ok(findByClass(t2, 'ap-file').length >= 2, '隐藏的 file input 少了一个');
  // 还没图 ⇒ 就地说明必须点明"还没选图片"（这一格此刻降级画的是别的，不说就是瞒着用户）。
  assert.ok(walk(t2).texts.some((x) => x.includes('还没选图片')),
    `"选了图片但还没选到图"没说明：${JSON.stringify(walk(t2).texts)}`);

  // 有图 ⇒ 出现"清掉图片"，说明里带上"点它会回到哪"。
  T.setBrandNameImage('/logo?which=name&v=9');
  let t3 = tree();
  assert.ok(findByProp(t3, 'data-ap-id', 'name-image-clear').length, '有图了却没有"清掉图片"');
  assert.ok(walk(t3).texts.some((x) => x.includes('清掉图片')), `有图时没说清点它会怎样：${JSON.stringify(walk(t3).texts)}`);

  // 窄面板（用户常在 430~500px 里看这个面板）：那一行是 flex-wrap，两组各自成块、
  // 每组自己也能换行 —— 整组换行才不会出现"选图片"和"清掉图片"被拆到两行去。
  assert.match(T.CSS, /\.ap-name\{[^}]*flex-wrap:wrap/);
  assert.match(T.CSS, /\.ap-name-grp\{[^}]*flex-wrap:wrap/);
  // 那句就地说明自己占一整行，否则它会挤在控件后面把那一行撑爆。
  assert.match(T.CSS, /\.ap-name-hint\{[^}]*flex:0 0 100%/);
  // 下拉自己画三角，且颜色读宿主令牌（红线：不许写死色值）。
  assert.match(T.CSS, /\.ap-name-selwrap::after\{[^}]*var\(--dsw-alias-label-tertiary/);
  assert.match(T.CSS, /\.ap-name-sel\{[^}]*var\(--dsw-alias-bg-layer-2/);
  // 三态齐（用户红线：上一版通篇零 :hover 就是"交互不行"）。
  assert.match(T.CSS, /\.ap-name-sel:hover:not\(\[disabled\]\)/);
  assert.match(T.CSS, /\.ap-name-sel:focus-visible/);
  // 侧栏那格画图时的约束与文字同一条：不许把侧栏撑开。
  assert.match(T.CSS, /\.ap-brandimg\{[^}]*max-width:100%[^}]*object-fit:contain/);
});

await checkA('ap-52 来源与存档那个 0/1 开关的映射：只有"自定义图片"会把它点上，切走一定要落回 false', async () => {
  resetRuntime();
  resetFetch();
  T.runtime.bootLoaded = true;
  T.setBrandNameImage('/logo?which=name&v=1'); // 先把图选上，免得"切回文字丢没丢地址"这条测了个空
  const lastBrand = () => JSON.parse(fetchCalls.find((c) => c.url.endsWith('/prefs')).init.body).brand;

  // 选了图片 ⇒ 开关点上（不然重启后那一格回到文字，用户以为白选了）。
  T.runtime.imageTouched = true;
  T.setBrandNameSource('image');
  await T.persistBrand();
  assert.equal(lastBrand().nameImage, true, '"自定义图片"没把开关点上');

  // 切回文字 ⇒ 必须落成 false：地址还留着（切回来立刻能画），但**此刻不算用图** ——
  // 写成 Boolean(nameImageUrl) 的话重启后会自作主张切回图片，用户选的"文字"就丢了。
  resetFetch();
  T.setBrandNameSource('text');
  await T.persistBrand();
  assert.equal(lastBrand().nameImage, false, '切回"文字"没把开关落回 false');
  assert.ok(T.runtime.brand.nameImageUrl, '切回文字把图地址丢了 —— 切回图片还得重选一张');

  // 官方字标 ⇒ 也是 false。
  resetFetch();
  T.setBrandNameSource('off');
  await T.persistBrand();
  assert.equal(lastBrand().nameImage, false);

  // 反过来：存档里是"图片" ⇒ 开局恢复成图片模式；图没落住时也尊重用户的选择（不悄悄改成文字）。
  resetRuntime();
  resetFetch();
  T.setBrandName('我的工作台');
  T.runtime.boot = { brand: { mode: 'off', markId: null, name: '我的工作台', nameImage: true }, nameLogoUrl: null };
  T.bootBrand();
  assert.equal(T.runtime.brand.nameMode, 'image', '存档说用图，开局却没恢复成图片模式');
  assert.equal(T.nameArt(), 'text', '图没落住时该降级画文字（不把那一格留空）');

  // 存档里没点名图片 ⇒ 有名字就是"文字"，连名字都没有就是"官方"。
  resetRuntime();
  T.runtime.boot = { brand: { mode: 'off', markId: null, name: '名字', nameImage: false }, nameLogoUrl: null };
  T.bootBrand();
  assert.equal(T.runtime.brand.nameMode, 'text');
  resetRuntime();
  T.runtime.boot = { brand: { mode: 'off', markId: null, name: null, nameImage: false }, nameLogoUrl: null };
  T.bootBrand();
  assert.equal(T.runtime.brand.nameMode, 'off');
});

check('ap-53 选「来源」本身不弹文件框：弹不弹只由用户点「选图片」那一下决定（用户 2026-10-04 要求）', () => {
  resetRuntime();
  resetFetch();
  hostPayload();
  entryCtx({ slots: makeStubSlots() });

  // 默认桩连 `document.getElementById` 都没有 ⇒ "选来源就把文件框带出来"这条旧行为在套件里
  // 是**隐形**的（它调用时静默返回 undefined）。所以这里把"文件框能被怎么打开"的两个入口
  // （`setTimeout` 延一拍 + `getElementById(...).click`）都装上探针，把这件事变成可观测的。
  const saved = { timer: globalThis.setTimeout, get: globalThis.document.getElementById };
  const opened = [];
  globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
  globalThis.document.getElementById = (id) => ({ click: () => opened.push(id) });
  try {
    const sel = findByProp(ReactStub.createElement(CLIENT.AppearancePage, {}), 'data-ap-id', 'name-src')[0];
    assert.ok(sel, '来源下拉不在 —— 这条断言会空转');
    const onChange = sel.props.onChange;
    assert.equal(typeof onChange, 'function', '下拉没有 onChange —— 这条断言会空转');
    for (const v of ['image', 'text', 'off', 'image']) onChange({ target: { value: v } });
    assert.equal(opened.length, 0,
      `选「来源」本身不许弹文件框（要弹只能由用户点「选图片」那个 label 触发），却去点了：${JSON.stringify(opened)}`);
  } finally {
    globalThis.setTimeout = saved.timer;
    if (saved.get === undefined) delete globalThis.document.getElementById;
    else globalThis.document.getElementById = saved.get;
  }
  resetRuntime();
});

// 异步用例到这里才真正跑（登记制）：漏写 await 也不会让它们被 process.exit 抢跑。
await runAsyncCases();
console.log(`\nclient: ${passed} 过 / ${failures.length} 挂`);
process.exit(failures.length ? 1 : 0);
