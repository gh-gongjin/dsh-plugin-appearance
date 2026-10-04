/**
 * lib/api.js —— 宿主半边的路由门面与跨边界常量
 *
 * 接口面：
 *   GET  /appearance/api/state   皮肤表 + 默认皮肤 + 浏览器半边最近一次回报（复核用）
 *   POST /appearance/api/report  浏览器半边把它在真机上量到的结果送回来缓存着
 *   GET  /appearance/api/prefs   存档里用户选的皮肤与标志（重启后恢复用）
 *   POST /appearance/api/prefs   写选择（未知皮肤 id / 未知标志档位一律拒）
 *   POST /appearance/api/logo    存用户挑的图片（类型与大小在这道门口重新验）
 *   GET  /appearance/api/logo    送回那张图片的字节
 *
 * 图片路由带一个 `?which=` 参数：`mark`（缺省）= 两格图标位那张，`name` = 名称行那张。
 * 两条路共用一个 handler、一道闸 —— 只差写进 `logo` 表的哪一行（见 lib/store.js 的 ROW_KEY_NAME）。
 *
 * 为什么要 report 这一条：验收要在真机判两件事 —— overrideTokens 吃不吃这 24 个令牌、
 * brand slot 的负 priority 官方认不认。这两件都发生在浏览器里，光看宿主日志看不到。
 * 有了它，复核就是一次 `GET /appearance/api/state`（探针一律 GET-only，见 sysops 那条血案），
 * 不必连浏览器控制台。
 *
 * 为什么 logo 要绕宿主一圈而不是浏览器直接 put data URL 到界面：浏览器那半边的存档只有
 * 内存，图片得落在宿主存储里才谈得上"重启还在"；绕这一圈还顺手把类型与大小重新验一遍 ——
 * 这条路由谁都能调，落库的是宿主自己的目录。
 */

import { LOGO_MIMES, LOGO_MAX_BYTES, LOGO_TARGETS } from './store.js';
import { SKIN_NONE_ID } from './skins.js';
import { BRAND_MODE_OFF, BRAND_MODE_BUILTIN } from './marks.js';

export const ROUTE_PREFIX = '/appearance';
/** index-inject 全局键：浏览器半边据此拿皮肤表。与 client.js 里的同名常量必须同值，测试钉住。 */
export const GLOBAL_KEY = '__APPEARANCE__';
export const PANEL_ID = 'appearance';
export const PANEL_LABEL = '桌面外观';
/** 回报里每个字符串字段的长度上限：浏览器送什么都不许把内存撑开。 */
const REPORT_FIELD_MAX = 240;
/**
 * 白名单。`spots` 是抽查读数（三个令牌各 ok / 没生效 + 实得值）：
 * 「我把层送进去了」与「界面真读到那个值」是两件事，复核要的是后者，
 * 而后者只在浏览器里量得到 —— 不带回来的话，GET /state 就只能证明前者。
 */
const REPORT_KEYS = ['skinId', 'applied', 'scheme', 'logo', 'spots', 'error'];
/** 图片正文上限：200KB 原图 base64 后约 267KB，再加 JSON 包装 —— 请求体卡 1MB 够用。 */
const LOGO_BODY_MAX = 1_000_000;
const DATA_URL_RE = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)?;base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * POST 请求体读取（真机路径）。**宿主 webServer 调 handler 只给 `(req, res)`**
 * （`@deepseek-ai/dsh-host-webserver/lib/index.js:235` → `await route.handler(req, res)`），
 * 第三个参数只有离线用例会给（喂成对象或 JSON 文本，验的是解析与白名单那一段）。
 * 口径照 dsh-plugin-sysops/lib/api.js:48-81：体自己拼、上限 1MB、坏 JSON 报 BAD_JSON。
 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req && typeof req === 'object' && req.__parsedBody && typeof req.__parsedBody === 'object') {
      return resolve(req.__parsedBody);
    }
    if (!req || typeof req.on !== 'function') return resolve({});
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('请求体过大'), { code: 'BAD_JSON' }));
        req.destroy?.();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', (e) => reject(Object.assign(new Error(String(e?.message ?? e)), { code: 'BAD_JSON' })));
  });
}

/**
 * @param {object} deps
 * @param {() => object} deps.state 当前对外状态（皮肤表 + 存档可用性 + 缓存的回报）
 * @param {(report: object) => void} deps.recordReport 缓存一条浏览器回报
 * @param {object|null} [deps.store] lib/store.js 的仓储；没给就是"这台机器存不住"
 */
export function createApiHandler({ state, recordReport, store = null }) {
  return async function handle(req, res, body) {
    const url = new URL(req.url, 'http://dsh.local');
    const pathname = url.pathname;
    const rest = pathname.slice(ROUTE_PREFIX.length) || '/';
    const method = (req.method || 'GET').toUpperCase();
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    const fail = (code, error) => send(code, { ok: false, error });

    if (method === 'GET' && rest === '/api/state') return send(200, { ok: true, data: state() });
    if (method === 'POST' && rest === '/api/report') {
      const parsed = await readJson(req, body, send);
      if (parsed === undefined) return undefined;
      return send(200, { ok: true, data: recordReport(parseReport(parsed)) });
    }

    if (rest === '/api/prefs') {
      if (!store) return fail(503, { code: 'STORE_UNAVAILABLE', message: '宿主没给存储通道，这台机器上存不住 —— 重启后回到原样' });
      if (method === 'GET') {
        try {
          return send(200, { ok: true, data: await readPrefs(store) });
        } catch (e) {
          return fail(statusOf(e), { code: e?.code ?? 'STORE_READ_FAILED', message: String(e?.message ?? e) });
        }
      }
      if (method === 'POST') {
        const parsed = await readJson(req, body, send);
        if (parsed === undefined) return undefined;
        try {
          const row = await store.writePrefs({
            skinId: parsed.skinId,
            brand: Object.hasOwn(parsed, 'brand') ? parsed.brand : undefined,
          });
          return send(200, { ok: true, data: await readPrefs(store, row) });
        } catch (e) {
          return fail(statusOf(e), { code: e?.code ?? 'STORE_WRITE_FAILED', message: String(e?.message ?? e) });
        }
      }
    }

    if (rest === '/api/logo') {
      // 缺省那格 = 两格图标位；`?which=name` 是名称行那张。别的取值当场拒 ——
      // 静默回落到 mark 会让"名称行存不上却把图标位覆盖了"变成一件难查的事。
      const asked = url.searchParams.get('which');
      const which = asked === null || asked === '' ? 'mark' : asked;
      if (!LOGO_TARGETS.includes(which)) {
        return fail(400, { code: 'BAD_LOGO', message: `图片只有 ${LOGO_TARGETS.join(' / ')} 两个去处，收到 ${String(asked).slice(0, 16)}` });
      }
      if (!store) return fail(503, { code: 'STORE_UNAVAILABLE', message: '宿主没给存储通道，这张图片存不下来' });
      if (method === 'GET') {
        try {
          const logo = await store.readLogo(which);
          if (!logo) return fail(404, { code: 'NO_LOGO', message: which === 'name' ? '还没有给名称行选过图片' : '还没有选过图片' });
          res.writeHead(200, {
            'content-type': logo.mime,
            // 正文是用户挑的文件：不嗅探（挡 text/html 那条路），URL 带版本号所以可以放心缓存。
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=31536000, immutable',
          });
          res.end(Buffer.from(logo.data, 'base64'));
          return undefined;
        } catch (e) {
          return fail(statusOf(e), { code: e?.code ?? 'STORE_READ_FAILED', message: String(e?.message ?? e) });
        }
      }
      if (method === 'POST') {
        const parsed = await readJson(req, body, send);
        if (parsed === undefined) return undefined;
        const input = logoInput(parsed);
        if (!input.ok) return fail(400, { code: 'BAD_LOGO', message: input.message });
        try {
          const saved = await store.writeLogo({ mime: input.mime, data: input.data, which });
          /**
           * 名称行那张图"存上了"同时意味着"用它"：开关在这一步点上。
           *
           * 为什么不让调用方自己再发一条 prefs 把开关打开：那是两条请求，第二条失败就变成
           * "图在库里、界面没变、重启后也没了" —— 一件很难查的事，而且看起来像路由坏了。
           * 图标位那两格不需要这个开关（它的启用状态由 `brandMode=image` 表达，本来就在 prefs 里），
           * 所以只有名称行这一路多写这一笔。
           */
          if (which === 'name') await store.writePrefs({ brand: { nameImage: true } });
          return send(200, { ok: true, data: { which, url: logoUrl(saved.updatedAt, which), mime: saved.mime } });
        } catch (e) {
          return fail(statusOf(e), { code: e?.code ?? 'BAD_LOGO', message: String(e?.message ?? e) });
        }
      }
    }

    return fail(404, { code: 'NOT_FOUND', message: `未知路由 ${method} ${rest}` });
  };
}

/** 存档 → 浏览器半边要的初始选择。`stored=false` 表示这台机器上从没写过（进来就是原样）。 */
async function readPrefs(store, row) {
  const { prefs, logo, nameLogo } = row
    ? { prefs: row, logo: await store.readLogo('mark'), nameLogo: await store.readLogo('name') }
    : await store.readAll();
  const mode = prefs?.brandMode ?? BRAND_MODE_OFF;
  return {
    skinId: prefs?.skinId ?? SKIN_NONE_ID,
    // 名称行与档位独立：图标是"原样"也照样可以有自定义名称（反之亦然）。
    brand: {
      mode,
      markId: mode === BRAND_MODE_BUILTIN ? prefs?.brandMarkId ?? null : null,
      name: prefs?.brandName ?? null,
    },
    logoUrl: logo ? logoUrl(logo.updatedAt, 'mark') : null,
    /**
     * 名称行那张图。**与 `brand.name` 是"图片优先"的关系**（用户 2026-10-04 选定）：
     * 两个都给了就画图，所以这里必须如实把两个都送过去，由浏览器半边决定画哪个 ——
     * 在这里替它"二选一"（比如有图就把 name 抹成 null）等于把文字删掉，用户就回不去了。
     *
     * **要不要用图由 prefs 里那个 0/1 标记说了算**，不是"logo 表里有没有 `name` 那行"：
     * 用户点了「清掉图片」之后，库里那张图的字节可能还在（见 lib/store.js 的 brandNameImage），
     * 那一格必须真的回到文字 —— 重启后也得是这样。
     */
    nameLogoUrl: prefs?.brandNameImage === 1 && nameLogo ? logoUrl(nameLogo.updatedAt, 'name') : null,
    stored: Boolean(prefs || logo || nameLogo),
    updatedAt: prefs?.updatedAt ?? logo?.updatedAt ?? nameLogo?.updatedAt ?? null,
  };
}

/**
 * 图片 URL 带版本号：换图后 updatedAt 变，浏览器才会去取新的而不是用缓存里那张旧的。
 * 两个去处各带各的 `which`（`mark` 是缺省值，所以图标位那条 URL 与第五轮长得一模一样）。
 */
export function logoUrl(updatedAt, which = 'mark') {
  const v = Number(updatedAt ?? 0) || 0;
  return which === 'mark'
    ? `${ROUTE_PREFIX}/api/logo?v=${v}`
    : `${ROUTE_PREFIX}/api/logo?which=${which}&v=${v}`;
}

/** 仓储错误 → HTTP 状态：能力没有 = 503，用户给的东西不对 = 400。 */
function statusOf(e) {
  const code = e?.code;
  if (code === 'STORE_UNAVAILABLE' || code === 'STORE_CLOSED') return 503;
  return 400;
}

/**
 * 浏览器送的 `{mime, dataUrl}` → `{mime, data}`。
 * 类型以 **data URL 前缀**为准，body 里那个 mime 字段只用来对账（两处不一致就拒）——
 * 落库的 mime 决定响应头，不能让调用方各说一份。
 */
function logoInput(raw) {
  const dataUrl = String(raw?.dataUrl ?? '');
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return { ok: false, message: '图片正文不是一个 base64 的 data URL' };
  const mime = m[1] ?? '';
  if (raw?.mime && String(raw.mime) !== mime) {
    return { ok: false, message: `声明的类型 ${String(raw.mime).slice(0, 40)} 与文件本身 ${mime} 不一致` };
  }
  if (!LOGO_MIMES.includes(mime)) {
    return { ok: false, message: `只收 ${LOGO_MIMES.join(' / ')}，收到 ${mime || '（无类型）'}` };
  }
  const data = m[2].replace(/\s/g, '');
  const bytes = Math.floor(data.length * 3 / 4);
  if (bytes === 0 || bytes > LOGO_MAX_BYTES) {
    return { ok: false, message: `图片约 ${bytes} 字节，上限 ${LOGO_MAX_BYTES} 字节（空文件与超限都拒）` };
  }
  return { ok: true, mime, data };
}

/** POST 体：undefined 时才自己从流里拼（真机形状）；读失败已经回了 400，调用方直接收摊。 */
async function readJson(req, body, send) {
  if (body !== undefined) return body;
  try {
    return await readBody(req);
  } catch (e) {
    send(400, { ok: false, error: { code: e?.code ?? 'BAD_JSON', message: String(e?.message ?? e) } });
    return undefined;
  }
}

/**
 * 只认白名单字段，逐个折成短字符串 —— 越界的、没声明的一律丢，不原样存。
 * 这条通道没有任何写系统的动作，但它存的东西会显示回界面上，
 * 所以"界面显示的等于浏览器声称的"这件事要在这里就封口。
 */
function parseReport(raw) {
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch { src = {}; }
  }
  if (!src || typeof src !== 'object') src = {};
  const out = {};
  for (const key of REPORT_KEYS) {
    const value = src[key];
    if (value === undefined || value === null) continue;
    out[key] = String(value).slice(0, REPORT_FIELD_MAX);
  }
  return out;
}
