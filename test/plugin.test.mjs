/**
 * test/plugin.test.mjs —— 宿主半边（index.js + lib/api.js）的装配与接口面。
 *
 * 装配口径与 index.js 逐字同形（sysops 那条"真机用例的装配口径必须与 index.js 同形"）：
 * 硬 inject 是空数组、webServer 走 ctx.inject 软等待、缺服务就不注册任何入口。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, name as PLUGIN_NAME, inject } from '../index.js';
import { ROUTE_PREFIX, GLOBAL_KEY, PANEL_ID } from '../lib/api.js';
import { SKINS, SKIN_SOURCE, DEFAULT_SKIN_ID, SKIN_NONE_ID } from '../lib/skins.js';
import { BRAND_MARKS, BRAND_NAME_MAX } from '../lib/marks.js';
import { LOGO_MIMES, LOGO_MAX_BYTES, DOMAIN_NAME } from '../lib/store.js';
import { makeStubStorage } from './_stubs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
/**
 * check 必须是 async 且调用点逐个 await：handler 是 async 的，同步 check 拿到的是
 * 一个没人理的 promise —— 断言全都没跑，套件却报"全绿"（sysops S18 记的那类假绿，本轮自查抓到）。
 */
async function check(name, fn) {
  try {
    await fn(); passed += 1; console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
}

/** 假 ctx：只实现 index.js 真正用到的三面（inject / on / logger），多一个键都没有。 */
function makeCtx({ withWebServer = true, storage = null } = {}) {
  const events = [];
  const registered = [];
  const injected = [];
  const webServer = withWebServer
    ? { register: (spec) => { registered.push(spec); return () => { spec.disposed = true; }; } }
    : undefined;
  const ctx = {
    registered,
    events,
    injected,
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    inject(names, cb) {
      injected.push(names.join(','));
      const face = { effect: (fn) => ctx.effect(fn) };
      for (const n of names) {
        if (n === 'webServer') { if (!webServer) return; face.webServer = webServer; continue; }
        if (n === 'storageDomain') { if (!storage) return; face.storageDomain = storage; continue; }
        return; // 桩里没有的服务：按真机语义"回调不执行"，插件据此降级
      }
      cb(face);
    },
    on(evt, cb) { events.push({ evt, cb }); },
    logger: { info() {}, warn() {} },
  };
  return ctx;
}

function fakeRes() {
  const out = { code: null, headers: null, body: null };
  return {
    out,
    writeHead(code, headers) { out.code = code; out.headers = headers; },
    end(body) { out.body = body; },
  };
}

async function call(handler, method, url, body) {
  const res = fakeRes();
  await handler({ url, method }, res, body);
  return { code: res.out.code, json: res.out.body ? JSON.parse(res.out.body) : null };
}

function emitIndexInject(ctx) {
  const table = [];
  for (const e of ctx.events) if (e.evt === 'webserver/index-inject') e.cb(table);
  return table;
}

await check('hs-1 宿主半边零 @deepseek-ai/* import（link: 挂载会解析出第二份模块实例）', () => {
  const files = ['index.js', 'lib/api.js', 'lib/skins.js', 'lib/marks.js', 'lib/store.js', 'lib/schema.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/@deepseek-ai\//.test(src.replace(/^\s*\*.*$/gm, '')), `${f} 里出现了 @deepseek-ai/ 引用`);
  }
});

await check('hs-1b 宿主半边零第三方依赖（只有 node: 与本地相对 import）', () => {
  for (const f of ['index.js', 'lib/api.js', 'lib/skins.js', 'lib/marks.js', 'lib/store.js', 'lib/schema.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      assert.ok(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:'),
        `${f} 引了外部包 ${spec}：link: 挂载下插件必须自带依赖，第一期一个都不要`);
    }
  }
});

await check('hs-2 导出形状：name / 零硬 inject / apply', () => {
  assert.equal(PLUGIN_NAME, 'appearance');
  assert.deepEqual(inject, [], '顶层硬 inject 会让"宿主缺任一服务"直接卡死插件加载');
  assert.equal(typeof apply, 'function');
});

await check('hs-3 没有 webServer → 一条路由都不注册、index-inject 载荷也不推', () => {
  const ctx = makeCtx({ withWebServer: false });
  const teardown = apply(ctx, {});
  assert.equal(ctx.registered.length, 0);
  assert.equal(emitIndexInject(ctx).length, 0, '没接口还推入口 = 点开空白页');
  assert.equal(typeof teardown, 'function');
  teardown();
});

await check('hs-4 webServer 到位 → 按 prefix 注册 /appearance', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  assert.equal(ctx.registered.length, 1);
  assert.equal(ctx.registered[0].kind, 'prefix');
  assert.equal(ctx.registered[0].path, ROUTE_PREFIX);
  assert.equal(typeof ctx.registered[0].handler, 'function');
});

await check('hs-5 index-inject 载荷与 lib/skins.js 逐字同表（一份真相，宿主侧不另存快照）', () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const table = emitIndexInject(ctx);
  assert.equal(table.length, 1);
  const row = table[0];
  assert.equal(row.kind, 'global');
  assert.equal(row.name, GLOBAL_KEY);
  assert.equal(row.value.routePrefix, ROUTE_PREFIX);
  assert.equal(row.value.api, `${ROUTE_PREFIX}/api`);
  assert.equal(row.value.panelId, PANEL_ID);
  assert.equal(row.value.source, SKIN_SOURCE);
  assert.equal(row.value.defaultSkinId, DEFAULT_SKIN_ID);
  assert.equal(row.value.noneSkinId, SKIN_NONE_ID);
  assert.deepEqual(row.value.skins.map((s) => s.id), SKINS.map((s) => s.id));
  assert.deepEqual(row.value.skins[0].tokens, SKINS[0].tokens, '令牌表在推送时被改写过');
});

await check('hs-6 GET /api/state → 200，报出皮肤表、默认档与存档可用性', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const r = await call(ctx.registered[0].handler, 'GET', `${ROUTE_PREFIX}/api/state`);
  assert.equal(r.code, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.defaultSkinId, DEFAULT_SKIN_ID);
  assert.equal(r.json.data.defaultSkinId, SKIN_NONE_ID, '默认档就是"不覆盖"：进来原样');
  assert.deepEqual(r.json.data.skins.map((s) => s.tokenCount), SKINS.map(() => 24));
  assert.deepEqual(r.json.data.marks.map((m) => m.id), BRAND_MARKS.map((m) => m.id), '内置标志清单没推给浏览器半边');
  assert.equal(r.json.data.store.available, false, '这台假 ctx 没给 storageDomain，state 必须如实报不可用');
  assert.equal(r.json.data.lastReport, null, '刚装配完不该已有回报');
});

await check('hs-7 POST /api/report 只收白名单六字段，超长串折到 240，junk 键丢掉', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const handler = ctx.registered[0].handler;
  const junk = { skinId: 'ink', applied: '24', evil: 'x'.repeat(5000), extra: { nested: 1 }, scheme: 'light', logo: 'x'.repeat(5000), spots: 'bg-base:ok', error: '' };
  const r = await call(handler, 'POST', `${ROUTE_PREFIX}/api/report`, junk);
  assert.equal(r.json.ok, true);
  assert.equal(Object.hasOwn(r.json.data, 'evil'), false, '白名单外的键被存下来了');
  assert.equal(Object.hasOwn(r.json.data, 'extra'), false);
  const back = await call(handler, 'GET', `${ROUTE_PREFIX}/api/state`);
  assert.equal(back.json.data.lastReport.skinId, 'ink');
  assert.equal(back.json.data.lastReport.logo.length, 240, '白名单内的字段也要有长度上限');
  assert.ok(!('evil' in back.json.data.lastReport));
});

await check('hs-8 字符串 body 也吃得下（浏览器发的是 JSON 文本），坏 JSON 退成空对象不抛', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const handler = ctx.registered[0].handler;
  const r1 = await call(handler, 'POST', `${ROUTE_PREFIX}/api/report`, JSON.stringify({ skinId: 'moss', applied: '24' }));
  assert.equal(r1.json.data.skinId, 'moss');
  const r2 = await call(handler, 'POST', `${ROUTE_PREFIX}/api/report`, '{不是 json');
  assert.equal(r2.code, 200);
  assert.equal(Object.keys(r2.json.data).length, 1, '坏 body 只该留下时间戳');
});

await check('hs-9 未知路由 → 404 且带 code，不裸 500', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const r = await call(ctx.registered[0].handler, 'GET', `${ROUTE_PREFIX}/api/nosuch`);
  assert.equal(r.code, 404);
  assert.equal(r.json.error.code, 'NOT_FOUND');
  const r2 = await call(ctx.registered[0].handler, 'DELETE', `${ROUTE_PREFIX}/api/report`);
  assert.equal(r2.code, 404, '方法不对也该 404，不给写通道留后门');
});

await check('hs-10 teardown 摘掉路由：disposer 来自 webServer.register 的返回值', () => {
  const ctx = makeCtx();
  const teardown = apply(ctx, {});
  teardown();
  assert.equal(ctx.registered[0].disposed, true);
  teardown(); // 重复收口不许炸
});

/**
 * 真机形状：宿主 `dsh-host-webserver/lib/index.js:235` 调的是 `route.handler(req, res)` —— **没有第三个参数**。
 * 上面 hs-7/hs-8 直接喂 body，走的是"预解析"那条分支，所以真机上"回报只剩 {at}"这两条都测不出来（本轮就是这么漏的）。
 * 这条把第三参省掉、只给一个会发 data/end 事件的 req，验体是自己拼出来的。
 */
function fakeReq(text, url = `${ROUTE_PREFIX}/api/report`) {
  const listeners = {};
  return {
    url, method: 'POST',
    on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); },
    destroy() {},
    emit() {
      setImmediate(() => {
        for (const c of listeners.data || []) c(Buffer.from(text.slice(0, 40), 'utf8'));
        const rest = text.slice(40);
        if (rest) for (const c of listeners.data || []) c(Buffer.from(rest, 'utf8'));
        for (const c of listeners.end || []) c();
      });
    },
  };
}

await check('hs-11 真机形状：handler 只收 (req,res) 时，请求体从流里自己拼出来', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const handler = ctx.registered[0].handler;
  const res = fakeRes();
  const req = fakeReq(JSON.stringify({ skinId: 'ink', applied: '24', scheme: 'light', logo: 'sidebar.brand.mark:ok@-1', spots: 'bg-base:ok' }));
  await Promise.all([handler(req, res), (req.emit(), new Promise((r) => setImmediate(r)))]);
  const json = JSON.parse(res.out.body);
  assert.equal(res.out.code, 200, `宿主那样调就该收下，实得 ${res.out.code}`);
  assert.equal(json.data.skinId, 'ink', '流里的体没拼出来（真机上 lastReport 就只剩 {at}）');
  assert.equal(json.data.spots, 'bg-base:ok');
  const back = await call(handler, 'GET', `${ROUTE_PREFIX}/api/state`);
  assert.equal(back.json.data.lastReport.logo, 'sidebar.brand.mark:ok@-1');
});

await check('hs-12 流里是坏 JSON → 400 带 code，不裸 500、也不把上一条读数冲掉', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const handler = ctx.registered[0].handler;
  const res = fakeRes();
  const req = fakeReq('{不是 json');
  await Promise.all([handler(req, res), (req.emit(), new Promise((r) => setImmediate(r)))]);
  const json = JSON.parse(res.out.body);
  assert.equal(res.out.code, 400);
  assert.equal(json.error.code, 'BAD_JSON');
  const back = await call(handler, 'GET', `${ROUTE_PREFIX}/api/state`);
  assert.equal(back.json.data.lastReport, null, '坏体不该覆盖掉上一条好读数');
});

/* ---- 存档通道：prefs 与 logo ---- */

/** 装上 webServer + storageDomain 的完整一套（真机最常见的那台机器）。 */
function bootWithStorage({ storage = makeStubStorage() } = {}) {
  const ctx = makeCtx({ storage });
  const teardown = apply(ctx, {});
  return { ctx, handler: ctx.registered[0].handler, storage, teardown };
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngDataUrl = (bytes = PNG_BYTES) => `data:image/png;base64,${bytes.toString('base64')}`;

await check('hs-13 没给 storageDomain → GET /api/prefs 如实 503，界面据此说明"这次进来是原样"', async () => {
  const { handler } = bootWithStorage({ storage: null });
  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r.code, 503);
  assert.equal(r.json.error.code, 'STORE_UNAVAILABLE');
  assert.match(r.json.error.message, /存不住|没给存储通道/, `消息要说人话：${r.json.error.message}`);
});

await check('hs-14 存档从没写过 → GET /api/prefs 报 skinId=none / mode=off / stored=false（原样，不是"空皮肤"）', async () => {
  const { handler } = bootWithStorage();
  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r.code, 200);
  assert.deepEqual(r.json.data, { skinId: 'none', brand: { mode: 'off', markId: null, name: null, nameImage: false }, logoUrl: null, nameLogoUrl: null, stored: false, updatedAt: null });
});

await check('hs-15 POST /api/prefs 写皮肤 → 再读读得回；未知皮肤 id 400 且旧值不动', async () => {
  const { handler } = bootWithStorage();
  const w = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { skinId: 'ink' });
  assert.equal(w.code, 200);
  assert.equal(w.json.data.skinId, 'ink');
  assert.equal(w.json.data.stored, true);
  const bad = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { skinId: 'nope-not-a-skin' });
  assert.equal(bad.code, 400, '未知 id 必须存不进去');
  assert.equal(bad.json.error.code, 'UNKNOWN_SKIN');
  const back = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(back.json.data.skinId, 'ink', '一次被拒的写入把旧存档改坏了');
});

await check('hs-16 标志档位：未知 mode 与未知内置款式都拒；builtin 写对了读得回 markId，切回 off 把它清掉', async () => {
  const { handler } = bootWithStorage();
  const badMode = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { brand: { mode: 'sparkle' } });
  assert.equal(badMode.code, 400);
  const badMark = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { brand: { mode: 'builtin', markId: 'not-a-mark' } });
  assert.equal(badMark.code, 400, '内置清单外的 markId 存进去 = 下次启动画不出东西');
  const ok = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { brand: { mode: 'builtin', markId: 'ring' } });
  assert.equal(ok.json.data.brand.markId, 'ring');
  const off = await call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, { brand: { mode: 'off' } });
  assert.deepEqual(off.json.data.brand, { mode: 'off', markId: null, name: null, nameImage: false });
});

// 编号排在这里是因为它跟 hs-16 是同一件事的两半（prefs 的 brand 那两个字段各自独立判存）；
// 原来误编成 hs-19，与下面 logo 那条撞了号 —— 撞号的用例在报告里认不出是哪一条。
await check('hs-16b 名称行：写进去读得回、超长 400、空白归一成"还给官方"，且与图标档位互不牵连', async () => {
  const { handler } = bootWithStorage();
  const write = (body) => call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, body);

  // 只写名字、图标保持"原样" —— 这是合法组合（两个字段各自独立判存）。
  const onlyName = await write({ brand: { mode: 'off', name: '我的工作台' } });
  assert.equal(onlyName.code, 200);
  assert.equal(onlyName.json.data.brand.name, '我的工作台');
  assert.equal(onlyName.json.data.brand.mode, 'off', '只改名字却把图标档位动了');

  // 前后空白要削掉：用户在输入框里多敲的空格不该原样进库。
  const padded = await write({ brand: { mode: 'off', name: '  留白  ' } });
  assert.equal(padded.json.data.brand.name, '留白');

  // 超长是 400 不是截断 —— 截断会让用户以为自己存的是完整那份。
  const tooLong = await write({ brand: { mode: 'off', name: 'x'.repeat(BRAND_NAME_MAX + 1) } });
  assert.equal(tooLong.code, 400, `长度上限 ${BRAND_NAME_MAX} 没在宿主这道门拦住`);
  assert.equal(tooLong.json.error.code, 'UNKNOWN_BRAND');

  // 空白 / null 一律归一成"这一格还给官方"（读回来是 null，不是空字符串）。
  const blank = await write({ brand: { mode: 'off', name: '   ' } });
  assert.equal(blank.json.data.brand.name, null, '空白没归一成"还给官方"');
  const cleared = await write({ brand: { mode: 'builtin', markId: 'ring', name: null } });
  assert.equal(cleared.json.data.brand.name, null);
  assert.equal(cleared.json.data.brand.markId, 'ring', '清名字把图标一起清了');

  // 只换图标、不带 name 字段：名称行那条旧值**不许**被顺手抹掉。
  await write({ brand: { mode: 'off', name: '别动我' } });
  const onlyMark = await write({ brand: { mode: 'builtin', markId: 'drop' } });
  assert.equal(onlyMark.json.data.brand.name, '别动我', '换图标时没带 name 字段，却把名字清了');
});

await check('hs-17 POST /api/logo 收下 png → GET /api/logo 送回**原字节**与类型（不是 data URL、不是 HTML）', async () => {
  const { handler } = bootWithStorage();
  const up = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo`, { mime: 'image/png', dataUrl: pngDataUrl() });
  assert.equal(up.code, 200);
  assert.match(up.json.data.url, /^\/appearance\/api\/logo\?v=\d+$/, `URL 要带版本号，换图后浏览器才不会用缓存：${up.json.data.url}`);
  const res = fakeRes();
  await handler({ url: up.json.data.url, method: 'GET' }, res);
  assert.equal(res.out.code, 200);
  assert.equal(res.out.headers['content-type'], 'image/png');
  assert.equal(res.out.headers['x-content-type-options'], 'nosniff', '正文是用户挑的文件，不嗅探就等于给了 text/html 一条路');
  assert.ok(Buffer.isBuffer(res.out.body), '图片要按字节回，不是 JSON 包一层');
  assert.deepEqual([...res.out.body], [...PNG_BYTES], '回来的字节与送进来的不是同一份');
});

await check('hs-18 logo 那道门：白名单外的类型、mime 与正文不一致、空文件、非 base64 —— 全拒', async () => {
  assert.ok(!LOGO_MIMES.includes('image/gif'), '前置条件变了：gif 已在白名单里，这条用例不再有意义');
  const { handler } = bootWithStorage();
  const cases = [
    [{ mime: 'image/gif', dataUrl: 'data:image/gif;base64,AAEC' }, '白名单外的类型'],
    [{ mime: 'image/png', dataUrl: 'data:image/svg+xml;base64,AAEC' }, '声明与正文不一致（落库的 mime 决定响应头）'],
    [{ mime: 'image/png', dataUrl: 'data:image/png;base64,' }, '空文件'],
    [{ mime: 'image/png', dataUrl: 'not-a-data-url' }, '不是 data URL'],
    [{ mime: 'text/html', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }, '当 HTML 送'],
    [{ mime: 'image/png', dataUrl: pngDataUrl(Buffer.alloc(LOGO_MAX_BYTES + 1024, 7)) }, '超上限'],
  ];
  for (const [body, why] of cases) {
    const r = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo`, body);
    assert.equal(r.code, 400, `${why}：本该拒掉，实得 ${r.code}`);
    assert.equal(r.json.error.code, 'BAD_LOGO', `${why}：错误码不对`);
  }
  const back = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(back.json.data.logoUrl, null, '被拒的图不该留下任何痕迹');
});

await check('hs-19 GET /api/logo 没存过 → 404 带 code，界面上是一条断链都不画', async () => {
  const { handler } = bootWithStorage();
  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/logo`);
  assert.equal(r.code, 404);
  assert.equal(r.json.error.code, 'NO_LOGO');
});

await check('hs-20 图片档的存在由 logo 表决定：写了图但 brandMode=off 时 logoUrl 照实报，浏览器不占格就不画', async () => {
  const { handler } = bootWithStorage();
  await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo`, { mime: 'image/png', dataUrl: pngDataUrl() });
  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r.json.data.brand.mode, 'off');
  assert(r.json.data.logoUrl, '库里真有图却不报出来，用户下次还得重挑');
});

/**
 * 真机形状的第二条：prefs 与 logo 这两条 POST 也一样只收 (req, res)。
 * hs-11 那次漏的就是"离线喂 body 把坑圆掉"，这里对新增的两条写通道补上同一道闸。
 */
await check('hs-21 真机形状（handler 只给 req,res）：POST /api/prefs 与 /api/logo 的体也从流里拼', async () => {
  const { handler } = bootWithStorage();
  async function postStream(path, payload) {
    const res = fakeRes();
    const req = fakeReq(JSON.stringify(payload), `${ROUTE_PREFIX}${path}`);
    await Promise.all([handler(req, res), (req.emit(), new Promise((r) => setImmediate(r)))]);
    return { code: res.out.code, json: JSON.parse(res.out.body) };
  }
  const p = await postStream('/api/prefs', { skinId: 'moss', brand: { mode: 'builtin', markId: 'hex' } });
  assert.equal(p.code, 200, `流里送的选择该收下，实得 ${p.code}`);
  assert.equal(p.json.data.skinId, 'moss');
  assert.equal(p.json.data.brand.markId, 'hex');
  const l = await postStream('/api/logo', { mime: 'image/png', dataUrl: pngDataUrl() });
  assert.equal(l.code, 200);
  assert(l.json.data.url);
});

await check('hs-22 库里残留一个已被删掉的皮肤 id（上一版存的）：读得回来、如实报，不在 GET 这一步炸', async () => {
  const storage = makeStubStorage();
  storage.preseed('prefs', 'current', { skinId: 'retired-skin', updatedAt: 1 });
  const { handler } = bootWithStorage({ storage });
  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r.code, 200, '读存档这一步不该因为一个旧 id 就炸（那是数据的错，不是用户的错）');
  assert.equal(r.json.data.skinId, 'retired-skin', '未知 id 要原样带回，由浏览器那半边的「未知皮肤」分支如实交代，不悄悄回落');
});

await check('hs-23 teardown 释放 domain 名：插件重载时第二次 open 不撞 already-open（漏 close 就是整半年打不开库）', async () => {
  const storage = makeStubStorage();
  const first = makeCtx({ storage });
  const t1 = apply(first, {});
  // 先真开一次：GET /api/prefs 会触发懒打开。没开过就没什么可释放，这条用例也就等于没测。
  const r1 = await call(first.registered[0].handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r1.code, 200);
  assert.equal(storage.openNames.length, 1, `domain 名没开出来：${JSON.stringify(storage.openNames)}`);

  t1();
  await new Promise((r) => setImmediate(r));
  assert.equal(storage.closes, 1, `卸载没 await 关闭存档 domain，实得 closes=${storage.closes}`);

  const second = makeCtx({ storage });
  apply(second, {});
  const r2 = await call(second.registered[0].handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r2.code, 200, `重载之后读不回存档：${JSON.stringify(r2.json)}`);
  t1(); // 重复收口不许炸
});

await check('hs-24 builtAt 是装配时刻、不是请求时刻（复核靠它判 lastReport 是不是上一轮会话留下的）', async () => {
  const ctx = makeCtx();
  const realNow = Date.now;
  let tick = 0;
  Date.now = () => 1000 + (tick += 1); // 每次调用都往前走，"现取"的话两次读数一定不同
  try {
    apply(ctx, {});
    const handler = ctx.registered[0].handler;
    const a = await call(handler, 'GET', `${ROUTE_PREFIX}/api/state`);
    const b = await call(handler, 'GET', `${ROUTE_PREFIX}/api/state`);
    assert.equal(a.json.data.builtAt, b.json.data.builtAt, '两次 GET 报出两个 builtAt = 它量的是请求时刻，那条判据就废了');
  } finally {
    Date.now = realNow;
  }
});

/* ------------------------------------------------------------------
 * 第六轮：名称行那一格也能换成图片（用户 2026-10-04 的第二条要求）。
 * 宿主的活只有一件 —— 图片多了一个去处，而那道门一个字都不许放松。
 * ------------------------------------------------------------------ */

await check('hs-25 两格图各存各的：?which=name 收下并送回原字节，图标位那张一个字节不动', async () => {
  const { handler } = bootWithStorage();
  const markBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
  const nameBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7, 7]);

  const upMark = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo`, { mime: 'image/png', dataUrl: pngDataUrl(markBytes) });
  assert.equal(upMark.code, 200);
  assert.equal(upMark.json.data.which, 'mark');
  // 第五轮就长这样，加了 which 之后缺省那条 URL 的写法不许变（旧档里的 URL 还在用）。
  assert.match(upMark.json.data.url, /^\/appearance\/api\/logo\?v=\d+$/, `缺省 URL 漂了：${upMark.json.data.url}`);

  const upName = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo?which=name`, { mime: 'image/png', dataUrl: pngDataUrl(nameBytes) });
  assert.equal(upName.code, 200, `名称行那张没存下：${JSON.stringify(upName.json)}`);
  assert.equal(upName.json.data.which, 'name');
  assert.match(upName.json.data.url, /^\/appearance\/api\/logo\?which=name&v=\d+$/, `名称行那张的 URL 要带 which：${upName.json.data.url}`);

  // 带着 which 去 GET，回来的必须是名称行那份；两条路的字节一对一。
  const nameRes = fakeRes();
  await handler({ url: upName.json.data.url, method: 'GET' }, nameRes);
  assert.equal(nameRes.out.code, 200);
  assert.deepEqual([...nameRes.out.body], [...nameBytes], '名称行那张回来的不是它自己那份');
  assert.equal(nameRes.out.headers['x-content-type-options'], 'nosniff', '新增这一路也得是 nosniff');

  const markRes = fakeRes();
  await handler({ url: upMark.json.data.url, method: 'GET' }, markRes);
  assert.deepEqual([...markRes.out.body], [...markBytes], '换名称行的图把图标位那张冲掉了 —— 两格本来就是各存各的');

  // 两条 URL 必须不同：共用一条 = 换一张图另一格跟着显示成它。
  const prefs = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert(prefs.json.data.logoUrl && prefs.json.data.nameLogoUrl, `两张图都该报出来：${JSON.stringify(prefs.json.data)}`);
  assert.notEqual(prefs.json.data.logoUrl, prefs.json.data.nameLogoUrl, '两个去处共用一个 URL');
});

await check('hs-26 名称行没选过图 → ?which=name 404 说清是哪一格；不认识的 which 当场 400，不许静默回落', async () => {
  const { handler } = bootWithStorage();
  const none = await call(handler, 'GET', `${ROUTE_PREFIX}/api/logo?which=name`);
  assert.equal(none.code, 404);
  assert.equal(none.json.error.code, 'NO_LOGO');
  assert.match(none.json.error.message, /名称行/, `消息要说清是哪一格，不然用户不知道该去哪儿补：${none.json.error.message}`);

  // 静默回落成 mark 会让"我以为存上了名称行的图，其实把图标位覆盖了"变成一件难查的事。
  const bogusGet = await call(handler, 'GET', `${ROUTE_PREFIX}/api/logo?which=hero`);
  assert.equal(bogusGet.code, 400, '不认识的 which 该当场拒');
  assert.equal(bogusGet.json.error.code, 'BAD_LOGO');
  const bogusPost = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo?which=hero`, { mime: 'image/png', dataUrl: pngDataUrl() });
  assert.equal(bogusPost.code, 400, '写这一路也得拒');

  // 空串与缺省等价（浏览器拼 URL 时可能留一个空的 which）。
  const blank = await call(handler, 'GET', `${ROUTE_PREFIX}/api/logo?which=`);
  assert.equal(blank.code, 404, '空 which 应当按缺省那格办（404 而不是 400）');
});

await check('hs-27 两个去处共用同一道门：?which=name 送 gif / 声明不符 / 空文件 / 超限 —— 一样拒', async () => {
  const { handler } = bootWithStorage();
  const cases = [
    [{ mime: 'image/gif', dataUrl: 'data:image/gif;base64,AAEC' }, '白名单外的类型'],
    [{ mime: 'image/png', dataUrl: 'data:image/svg+xml;base64,AAEC' }, '声明与正文不一致'],
    [{ mime: 'image/png', dataUrl: 'data:image/png;base64,' }, '空文件'],
    [{ mime: 'image/png', dataUrl: 'not-a-data-url' }, '不是 data URL'],
    [{ mime: 'image/png', dataUrl: pngDataUrl(Buffer.alloc(LOGO_MAX_BYTES + 1024, 7)) }, '超上限'],
  ];
  for (const [body, why] of cases) {
    const r = await call(handler, 'POST', `${ROUTE_PREFIX}/api/logo?which=name`, body);
    assert.equal(r.code, 400, `${why}：名称行这一路本该也拒，实得 ${r.code}`);
  }
  const prefs = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(prefs.json.data.nameLogoUrl, null, '被拒的图不该在名称行留下痕迹');
});

await check('hs-28 图与文字是"两个都报"：宿主不替界面做二选一（有图就把文字抹掉 = 用户回不去）', async () => {
  const storage = makeStubStorage();
  // `brandNameImage: 1` 就是那个 0/1 开关 —— 老档里"图存过 + 开关点过"才真的算数。
  // （只存了 `logo` 那行、开关没点，是"点了清掉图片"之后的状态，见 hs-28 后半段。）
  storage.preseed('prefs', 'current', { brandMode: 'off', brandName: '奋进的个人工作台', brandNameImage: 1, updatedAt: 5 });
  storage.preseed('logo', 'name', { mime: 'image/png', data: PNG_BYTES.toString('base64'), updatedAt: 6 });
  const { handler } = bootWithStorage({ storage });

  const r = await call(handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(r.code, 200);
  // 用户 2026-10-04 选定的口径是"图片优先、文字留着"。宿主这边只要如实把两个都送过去；
  // 在这里抹掉任何一个都是在替浏览器半边做决定，而它做的那个决定是用户回不去的。
  assert.equal(r.json.data.brand.name, '奋进的个人工作台', '有图就把文字抹掉了');
  // 那个 0/1 开关必须**原样送到页面**：页面恢复"那一格用的是哪个来源"只认它（client.js 的 bootBrand）。
  // 少了这一个字段，图上一次重启就掉回文字 —— 用户 2026-10-04 报的正是这条。
  assert.equal(r.json.data.brand.nameImage, true, `宿主没把名称行的图片开关报给页面 —— 重启后那一格会掉回文字：${JSON.stringify(r.json.data.brand)}`);
  assert.match(r.json.data.nameLogoUrl, /which=name/, `名称行这张图的 URL 要带 which：${r.json.data.nameLogoUrl}`);
  assert.equal(r.json.data.stored, true, '只有名称行那张图时也得算"存过"');

  // 反过来：只选过图标位那张图的老档，名称行那格必须是 null（不是空串、不是 undefined）。
  const legacy = bootWithStorage();
  await call(legacy.handler, 'POST', `${ROUTE_PREFIX}/api/logo`, { mime: 'image/png', dataUrl: pngDataUrl() });
  const old = await call(legacy.handler, 'GET', `${ROUTE_PREFIX}/api/prefs`);
  assert.equal(old.json.data.nameLogoUrl, null, '只存过图标位那格时，名称行该如实报"没有"');
  assert.equal(old.json.data.brand.nameImage, false, '没点过开关时报合必须是真的 false，不是 undefined —— 页面那边 `=== true` 才切图片档');
});

await check('hs-29 最小 patch 合法：`brand` 底下每个字段各自独立判存（只清图片 / 只改文字都不许连带别字段）', async () => {
  const { handler } = bootWithStorage();
  const write = (body) => call(handler, 'POST', `${ROUTE_PREFIX}/api/prefs`, body);

  await write({ brand: { mode: 'builtin', markId: 'ring', name: '别动我' } });

  // 只关掉图片开关（浏览器半边"清掉图片"发的就是这一条）：档位与文字必须原封不动。
  const off = await write({ brand: { nameImage: false } });
  assert.equal(off.code, 200, `只带一个字段的 patch 被拒了 —— 那会让"清掉图片"没法只清图片：${JSON.stringify(off.json)}`);
  assert.equal(off.json.data.brand.mode, 'builtin', '只清图片却把档位动了');
  assert.equal(off.json.data.brand.markId, 'ring');
  assert.equal(off.json.data.brand.name, '别动我', '只清图片却把文字抹了');

  // 反过来：只改文字，图片开关不动（这条同时钉住"没带 mode 也不许抛"）。
  await write({ brand: { nameImage: true } });
  const renamed = await write({ brand: { name: '换个名字' } });
  assert.equal(renamed.code, 200, `只改文字被拒了：${JSON.stringify(renamed.json)}`);
  assert.equal(renamed.json.data.brand.name, '换个名字');
  assert.equal(renamed.json.data.brand.mode, 'builtin', '只改文字却把档位动了');

  // 空对象也收（浏览器半边"我们现在什么都不知道"时发的就是它），不许炸。
  const noop = await write({ brand: {} });
  assert.equal(noop.code, 200);
  assert.equal(noop.json.data.brand.name, '换个名字');

  // 但**带了 mode 就必须是对的**：逐字段放行的放宽只针对"没带"，不是针对"带了个坏值"。
  const bad = await write({ brand: { mode: 'hero' } });
  assert.equal(bad.code, 400, '带了个不认识的档位却被收下了');
  assert.equal(bad.json.error.code, 'UNKNOWN_BRAND');
});

console.log(`\nplugin: ${passed} 过 / ${failures.length} 挂`);
process.exit(failures.length ? 1 : 0);
