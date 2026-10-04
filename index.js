/**
 * ============================================================
 * dsh-plugin-appearance —— Host Half（宿主半边）index.js
 * ============================================================
 *
 * 这一半做四件事：
 *   1. 探 webServer；有路由就开 `/appearance` 前缀（state / report / prefs / logo 四类），
 *      没有就一个入口都不注册（点开空白页比看不到入口更糟，口径照 sysops spec §4.6）；
 *   2. 探 storageDomain；有就惰性打开存档 domain（lib/store.js），把用户挑的皮肤与标志记住；
 *      没有就照实报"这台机器存不住"，界面不假装记住了；
 *   3. 经 `webserver/index-inject` 把皮肤表、内置标志清单与默认档位推给浏览器半边
 *      （一份真相在 lib/skins.js 与 lib/marks.js）；
 *   4. 缓存浏览器半边的回报，供真机复核时一次 GET 读到。
 *
 * 为什么 inject = []（零硬 inject）：Cordis 的 Context 是代理，读未 inject 的服务直接抛
 * `cannot get property without inject`。把 webServer / storageDomain 写进顶层 inject
 * 会让"宿主没起那个服务"直接卡死插件加载。所以按需注入、缺就降级。
 *
 * 为什么零 @deepseek-ai/* import：本插件以 link: 挂在 profile 下，一旦 import dsh 内部包，
 * Node 会从插件自己的 node_modules 解析出第二份模块实例，模块私有状态不共享（同 sysops 全局约束 1）。
 * 所以连 storageDomain 的 domain spec 都是自己造的等价对象（lib/schema.js）。
 *
 * 仍然**故意不做**的东西（不是漏了）：
 *   · 背景图 / 字体 —— 要先确认资源怎么送达浏览器，见 spec §5-U4；
 *   · Windows 桌面壁纸 —— 那要起子进程改系统状态，第一期范围外。
 */

import {
  createApiHandler, ROUTE_PREFIX, GLOBAL_KEY, PANEL_ID, PANEL_LABEL,
} from './lib/api.js';
import {
  SKINS, SKIN_SOURCE, SKIN_NONE_ID, DEFAULT_SKIN_ID,
} from './lib/skins.js';
import { BRAND_MARKS, BRAND_DEFAULT_MODE } from './lib/marks.js';
import { createAppearanceStore, DOMAIN_NAME } from './lib/store.js';

export const name = 'appearance';
export const inject = [];

export function apply(ctx, config = {}) {
  /** 浏览器半边送回来的最后一条读数（内存里存一份，不落盘）。 */
  let lastReport = null;
  let routeDisposer = null;
  /** 路由到没到位。index-inject 那半边必须读它：没接口还推入口，用户点开就是一张空白页。 */
  let routeReady = false;
  /** 宿主存储设施。inject 回调跑过才有值；读它一律走取值函数（坑 1）。 */
  let storageFacility = null;
  const store = createAppearanceStore({ getFacility: () => storageFacility });
  /** 本进程装配起来的时刻。复核靠它判 `lastReport` 是不是上一轮会话留下的 —— 每次 GET 现取就成了"请求时间"，那条判据就废了。 */
  const builtAt = Date.now();

  const storeState = () => ({
    available: store.available,
    domain: DOMAIN_NAME,
    message: store.available ? null
      : '宿主没给存储通道，这台机器上存不住 —— 重启后回到原样',
  });

  const state = () => ({
    panelId: PANEL_ID,
    label: PANEL_LABEL,
    source: SKIN_SOURCE,
    defaultSkinId: DEFAULT_SKIN_ID,
    noneSkinId: SKIN_NONE_ID,
    defaultBrandMode: BRAND_DEFAULT_MODE,
    store: storeState(),
    skins: SKINS.map((s) => ({ id: s.id, name: s.name, note: s.note, tokenCount: Object.keys(s.tokens).length })),
    marks: BRAND_MARKS,
    lastReport,
    builtAt,
  });

  const apiHandler = createApiHandler({
    state,
    store,
    recordReport: (report) => {
      lastReport = { ...report, at: Date.now() };
      return lastReport;
    },
  });

  ctx.inject(['webServer'], (w) => {
    const webServer = w.webServer;
    if (!webServer || typeof webServer.register !== 'function') return;
    const register = () => {
      const disposer = webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res, body) => apiHandler(req, res, body),
      });
      routeDisposer = typeof disposer === 'function' ? disposer : null;
      routeReady = true;
    };
    if (typeof w.effect === 'function') w.effect(register, 'appearance:route');
    else register();
  });

  ctx.inject(['storageDomain'], (s) => {
    storageFacility = s.storageDomain;
  });

  ctx.on('webserver/index-inject', (table) => {
    if (!routeReady) return;
    // 载荷里的表每次现算：lib/skins.js 与 lib/marks.js 是唯一出处，这里不另存快照。
    table.push({
      kind: 'global',
      name: GLOBAL_KEY,
      value: {
        panelId: PANEL_ID,
        label: PANEL_LABEL,
        routePrefix: ROUTE_PREFIX,
        api: `${ROUTE_PREFIX}/api`,
        source: SKIN_SOURCE,
        // 默认档 = 原样：不套任何皮肤、不占任何 brand 格。存档里真有过选择才由浏览器半边覆盖。
        defaultSkinId: DEFAULT_SKIN_ID,
        noneSkinId: SKIN_NONE_ID,
        defaultBrandMode: BRAND_DEFAULT_MODE,
        store: storeState(),
        skins: SKINS.map((s) => ({ id: s.id, name: s.name, note: s.note, tokens: s.tokens })),
        marks: BRAND_MARKS,
      },
    });
  });

  ctx.logger?.info?.(
    `[appearance] 宿主半边已装配（皮肤 ${SKINS.length} 张 / 内置标志 ${BRAND_MARKS.length} 枚 / `
    + `默认 ${SKIN_NONE_ID} 原样 / 存档 ${store.available ? '可用' : '不可用'}）`,
  );

  return () => {
    const dispose = routeDisposer;
    routeDisposer = null;
    if (dispose) dispose();
    // domain 名要调用方自己释放；close 是 async，这里只能尽力而为（重载前一般有收口窗口）。
    store.close().catch((e) => ctx.logger?.warn?.(`[appearance] 存档关闭失败：${e?.message ?? e}`));
  };
}
