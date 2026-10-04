/* ============================================================
 * dsh-plugin-appearance —— Browser Client Half（浏览器半边）
 * ============================================================
 * 干三件事：
 *   1) 用 ctx.theme.overrideTokens 把一张皮肤叠在内置配色上（不注册新主题 id，见下方说明）；
 *   2) 需要时占三格 brand 槽位：两格图标位（侧栏 / 会话首屏）换用户挑的那枚图标，
 *      外加名称行那一格（`sidebar.brand.name`）—— 那一格能放文字、也能放一张图（图片优先）；
 *   3) 往侧栏面板表 + 主列面板位注册「桌面外观」页，用来选皮肤与标志、看生效读数。
 *
 * **进来是原样**：装配时一格 brand 都不注册、一张皮肤也不套（默认 id 就是 'none'）。
 * 用户点过才动，点回原样就调注册返回的 disposer 撤干净、官方那条自己回到渲染位。
 *
 * 为什么走 overrideTokens 而不是 register(ThemeDefinition)：
 *   ThemeDefinition 一份只带**一个** colorScheme（light 或 dark），选它就得放弃内置的
 *   light/dark/system 三档切换。overrideTokens 的层是 {令牌: {light, dark}}，
 *   叠在当前活动主题上，用户照旧用内置那行切明暗、皮肤两档跟着换 —— 这才是"皮肤"。
 *
 * 为什么这一半不写任何宿主 CSS 覆盖：
 *   换肤只经 ctx.theme 这个官方通道，改界面只经 slot。注入全局样式能盖出更多效果，
 *   但那是官方面之外，宿主改版就跟不上（第一期范围外，见 docs/design-spec.md §5-U4）。
 *
 * 红线：不写宿主文件、不注入全局 CSS（本插件自己的界面样式除外，且只读宿主令牌）、
 *   不碰系统设置。选择经宿主 storageDomain 存住（lib/store.js），存不住时界面上就地说明，
 *   不假装记住了。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-appearance',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const { useState } = React;

    /** 与 lib/api.js 的 GLOBAL_KEY 导出同值（ap-2 两头盯住这一约定）。 */
    const GLOBAL_KEY = '__APPEARANCE__';
    const SKIN_SOURCE = 'dsh-plugin-appearance';
    const SKIN_NONE_ID = 'none';
    /**
     * brand 遮蔽档位。宿主规则：同一格按 priority 升序排，**最低的那条渲染**；
     * 官方品牌包以默认 0 占着这两格，同档再注册会抛错。所以这里要负数才盖得过它。
     * 真机已量过：负档运行时接受，我们成了渲染的那条（spec §1 决策 2、§5-U1 结案）。
     */
    const BRAND_PRIORITY = -1;
    /**
     * 两格图标位。跟**档位**走：mode !== off 就占上，off 就还给官方。
     */
    const BRAND_MARK_SLOTS = ['sidebar.brand.mark', 'conversation.hero.brand.mark'];
    /**
     * 名称行（`sidebar.brand.name`，就是侧栏那行 deepseek / HARNESS 字标）。
     * **单独一格、单独判断**：跟"用户有没有填字"走，不跟图标档位走 ——
     * 只换名字不换图标、或只换图标不换名字，两种都是合法组合。
     * 用户 2026-10-04 点明要它可换（第二轮曾按"没勾就不动"撤掉过这一格）。
     */
    const BRAND_NAME_SLOT = 'sidebar.brand.name';
    const BRAND_MODE_OFF = 'off';
    const BRAND_MODE_BUILTIN = 'builtin';
    const BRAND_MODE_IMAGE = 'image';
    /** 与 lib/marks.js 的 BRAND_MODES 同值（ap-20 两头钉住）。 */
    const BRAND_MODES = [BRAND_MODE_OFF, BRAND_MODE_BUILTIN, BRAND_MODE_IMAGE];
    const PANEL_ID = 'appearance';
    /**
     * 图片标志的两条门槛。与 lib/store.js 的 LOGO_MIMES / LOGO_MAX_BYTES 同值，
     * 由 ap-20 两头钉住 —— 浏览器先挡住是为了立刻给话，宿主再挡一次才是真的（那条路由谁都能调）。
     */
    const LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    /**
     * 白名单 mime → 给用户看的格式名。**界面上那句格式清单由 LOGO_ALLOWED_MIMES 派生**
     * （不是手写一遍），所以以后动白名单，文案自己跟着走，不会漂。
     */
    const LOGO_MIME_LABELS = {
      'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG',
    };
    const LOGO_MAX_BYTES = 200 * 1024;
    /** 名称行文字上限。与 lib/marks.js 的 BRAND_NAME_MAX 同值（ap-20 两头钉住）。 */
    const BRAND_NAME_MAX = 24;
    /**
     * 交给我们处理**之前**的原图上限。超了直接拒 —— 解码一张 50MB 的图会把主线程卡住，
     * "自动处理"不该以冻住界面为代价。
     */
    const LOGO_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
    /** 成品边长。两格图标位实际只有 20~32px（侧栏折叠 rail 更小），512 是留给高分屏的余量。 */
    const LOGO_TARGET_PX = 512;
    /**
     * 名称行那张图的两个上限。那一格是**横长条**（侧栏那行字标），所以：
     *   · 换的是"框"不是"方" —— 宽 512 够高分屏，高 160 是给字标高出来的余量（真机行高只有 20~40px）；
     *   · **不裁切** —— 横向 wordmark 裁成方只剩中间一小块，那等于把用户的图毁了（见 SHAPE_OF）。
     */
    const NAME_LOGO_MAX_W = 512;
    const NAME_LOGO_MAX_H = 160;
    /** 图片的两个去处。与 lib/store.js 的 LOGO_TARGETS 同值（ap-20 两头钉住）。 */
    const LOGO_TARGET_MARK = 'mark';
    const LOGO_TARGET_NAME = 'name';
    const LOGO_TARGETS = [LOGO_TARGET_MARK, LOGO_TARGET_NAME];
    /**
     * 名称行那一格的**来源**（用户 2026-10-04 第三轮要求：改成下拉选，不同选项对应不同操作）。
     *
     * 这三个值不是"我又加了一层状态"，而是把那一格本来就有的三种状态**显式化**：
     *   · `off`   —— 不用文字也不用图，归官方字标；
     *   · `text`  —— 用用户填的字；
     *   · `image` —— 用用户选的图。
     * 在此之前这三种状态是从"有没有文字 / 有没有图片地址"**反推**出来的，于是"选了图片但还没选图"
     * 这种中间态根本表达不出来（下拉会立刻跳回上一项）。现在它是显式的，而落盘仍然只投影成
     * 宿主那两个字段（`name` / `nameImage`），所以存档格式一个字没改、旧档照样读得回来。
     */
    const NAME_SRC_OFF = 'off';
    const NAME_SRC_TEXT = 'text';
    const NAME_SRC_IMAGE = 'image';
    const NAME_SRC_LIST = [NAME_SRC_OFF, NAME_SRC_TEXT, NAME_SRC_IMAGE];
    const NAME_SRC_LABELS = {
      [NAME_SRC_OFF]: '官方字标',
      [NAME_SRC_TEXT]: '自定义文字',
      [NAME_SRC_IMAGE]: '自定义图片',
    };
    /**
     * 两个去处各自的形状口径。**只有"裁不裁"和"框多大"不同**：
     * 解码、透明判定、质量阶梯、压不下去就降分辨率、以及"压完反而更大就用原图"这些兜底全共用 ——
     * 分成两份实现迟早会漂（一处加了兜底另一处没有，用户会以为"名称行那张没处理好"）。
     */
    const SHAPE_OF = {
      [LOGO_TARGET_MARK]: { crop: true, maxW: LOGO_TARGET_PX, maxH: LOGO_TARGET_PX },
      [LOGO_TARGET_NAME]: { crop: false, maxW: NAME_LOGO_MAX_W, maxH: NAME_LOGO_MAX_H },
    };
    /** 质量阶梯：从高到低找第一个压到上限以内的；整条都不行才降分辨率重来。 */
    const LOGO_QUALITY_STEPS = [0.92, 0.84, 0.75, 0.66, 0.55, 0.45];
    /** 生效核对时抽查的令牌：一张背景、一个文字、一个强调色。 */
    const SPOT_TOKENS = ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-brand-primary'];

    const cfg = () => globalThis[GLOBAL_KEY] || {};
    const skinList = () => (Array.isArray(cfg().skins) ? cfg().skins : []);
    const skinById = (id) => skinList().find((s) => s && s.id === id) || null;
    const markList = () => (Array.isArray(cfg().marks) ? cfg().marks : []);
    const markById = (id) => markList().find((m) => m && m.id === id) || null;

    /* ------------------------------------------------------------
     * 1) 生效状态（模块内单点：面板画它，回报也读它，杜绝两份各说各话）
     * ------------------------------------------------------------ */
    const runtime = {
      themeReady: false,
      skinId: null,
      appliedCount: 0,
      layerError: null,
      brandRows: [],
      /**
       * 标志选择的当前账：mode = off | builtin | image。默认 off —— 进来是原样。
       *
       * 名称行那一格（`sidebar.brand.name`）与 mode **相互独立**，用户看到的它有三个来源（`nameMode`）：
       *   · `off`   —— 官方字标（这一格连 inject 之外的动作都没有）；
       *   · `text`  —— 画 `name` 那段字（null = 还没填，那一格暂时仍是官方）；
       *   · `image` —— 画 `nameImageUrl` 那张图。
       * 文字与图片**各存各的**，切走不毁数据：从 `image` 切到 `text` 时图与地址都留着，
       * 切回去立刻能画回来；只有「清掉图片」与「官方字标」才会把地址清掉。
       * `nameMode === 'image'` 但还没选到图时**降级**画文字（没文字就还给官方）—— 不把那一格留空，
       * 界面上同时写明"还没选图片"。
       */
      brand: {
        mode: BRAND_MODE_OFF, markId: null, imageUrl: null,
        name: null, nameMode: NAME_SRC_OFF, nameImageUrl: null, error: null,
      },
      /** 宿主声明过哪几格 brand。没声明的格子不能注册（会抛 "slot is not declared"）。 */
      brandDeclared: new Set(),
      spots: [],
      scheme: null,
      /** 存档这一侧的坏消息（读不到 / 写不进）：一律在界面上说，别让用户以为重启后还在。 */
      storeNote: null,
      /** 宿主存档里带回来的初始选择。null = 还没读到（此时一律按"原样"办，绝不自己猜一张皮肤）。 */
      boot: null,
      /**
       * 存档**读回来了**没有。没回来时我们对存档里那几格一无所知（库里可能有一份），
       * 所以写通道不许拿"我们这边的默认值"去覆盖它 —— 宿主的写是整份覆盖。
       * 配下面三个"用户动过没有"的开关一起用，见 persistBrand。
       */
      bootLoaded: false,
      /** 用户动过档位（点过标志 / 选过图片）没有。 */
      markTouched: false,
      /** 用户动过名称行的**文字**没有。 */
      nameTouched: false,
      /** 用户动过名称行的**图片开关**没有（选图 / 清图 / 还原官方都算）。 */
      imageTouched: false,
      /** 用户在存档回来之前就已经点过 —— 那之后不再让迟到的存档盖掉他的选择。 */
      userChose: false,
    };

    const bootSkinId = () => runtime.boot?.skinId ?? cfg().defaultSkinId ?? SKIN_NONE_ID;

    /** 选择写回宿主存档。皮肤与标志共用这一条通道，失败只记一句人话。 */
    async function persist(patch) {
      if (!cfg().api) return false;
      try {
        const r = await fetch(`${cfg().api}/prefs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j?.ok) {
          runtime.storeNote = `${j?.error?.message ?? `HTTP ${r.status}`} —— 下次重启回到原样`;
          return false;
        }
        runtime.storeNote = null;
        return true;
      } catch (e) {
        runtime.storeNote = `存这一步断了：${e?.message ?? e} —— 下次重启回到原样`;
        return false;
      }
    }

    const persistSkin = (id) => persist({ skinId: id });
    /**
     * 写标志那一整条通道（档位 + 名称行的三样东西）。
     *
     * **宿主的写是整份覆盖**，所以送上来的每个字段都等于"这就是最新值"，于是每个字段都要先问
     * "我们现在知道它是什么吗"：存档还在路上（`bootLoaded=false`）而用户也没动过它 ⇒ **不带它**。
     * 少了这道判断，"进来立刻就点一枚标志"会把用户上次存的名字（或档位）顺手抹成空 ——
     * 那是一次只持续几十毫秒的竞态，但它是真丢数据，而宿主那边看到的只是一条正常 patch。
     *
     * 三个开关各管一个字段，粒度跟宿主那边的 `Object.hasOwn` 判断一一对应。
     */
    const persistBrand = () => {
      const brand = {};
      if (runtime.bootLoaded || runtime.markTouched) {
        brand.mode = runtime.brand.mode;
        brand.markId = runtime.brand.markId ?? null;
      }
      // 名称行那一格的三样东西各存各的（宿主那边三个字段各自独立判存，只换名字时 mode 仍是 off）。
      // **图片的字节不在这条 patch 里** —— 它由 `POST /api/logo?which=name` 单独送，这里只送开关。
      if (runtime.bootLoaded || runtime.nameTouched) brand.name = runtime.brand.name ?? null;
      /**
       * 「用不用图」由**下拉选的那个来源**说了算，不是"地址在不在"：
       * 用户切到「自定义文字」时地址还留着（切回来立刻能画），但那一格此刻不该算用图 ——
       * 写成 `Boolean(nameImageUrl)` 的话，重启后它会自作主张切回图片模式，用户选过的"文字"就丢了。
       */
      if (runtime.bootLoaded || runtime.imageTouched) brand.nameImage = runtime.brand.nameMode === NAME_SRC_IMAGE;
      return persist({ brand });
    };

    async function postReport() {
      if (!cfg().api) return;
      /**
       * 名称行那一格单独报一句：它是"两张脸"（文字 / 图片），而页头摘要只报"哪一样"。
       * 真机复核那几条（§5-U12/U13/U14）要判的正是"那一格到底画了什么"，光看 `2 格 / 3 格` 判不了。
       * 挂在 `logo` 那个字段的**末尾**（宿主那边的白名单一个字不改）：前缀仍是档位，
       * 所以既有的读法（`^builtin:ring `）照样成立，多的只是尾巴上这一句。
       */
      // 报的是"那一格**画的是什么**"，不是下拉停在哪一项 —— 真机复核（§5-U14）要判的正是
      // 用户眼前那一格，而"选了图片但还没选到图"时它画的确实是文字/官方，如实报。
      const artNow = nameArt();
      const nameState = artNow === 'image' ? '图片' : (artNow === 'text' ? '文字' : '官方');
      const brand = (runtime.brand.mode === BRAND_MODE_OFF
        ? '原样'
        : `${runtime.brand.mode}:${runtime.brand.markId ?? 'image'}`
          + (runtime.brandRows.length
            ? ` ${runtime.brandRows.map((r) => `${r.slot}=${r.ok ? 'ok' : `throw(${r.error})`}@${r.priority}`).join(' ')}`
            : ' 未注册'))
        + ` 名称行=${nameState}`;
      const spots = runtime.spots.length
        ? runtime.spots.map((s) => (s.note
          ? '读不到档'
          : `${s.token.replace('--dsw-alias-', '')}:${s.ok ? 'ok' : `≠${s.got ?? '—'}`}`)).join(' ')
        : '未抽查';
      const body = {
        skinId: runtime.skinId ?? '',
        applied: String(runtime.appliedCount),
        scheme: runtime.scheme ?? '',
        logo: brand,
        spots,
        error: runtime.layerError ?? '',
      };
      try {
        await fetch(`${cfg().api}/report`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        // 回报送不出去只影响"宿主那边读不读得到"，不影响换肤本身；界面上如实说。
        runtime.reportFailed = true;
      }
    }

    /* ------------------------------------------------------------
     * 2) 皮肤层：应用 / 清除 / 抽查
     * ------------------------------------------------------------ */
    /**
     * @param {object} theme ctx.theme
     * @param {string} id 皮肤 id 或 'none'
     * @returns {boolean} 是否按预期落下去了（'none' 的清层也算成功）
     */
    function applySkin(theme, id) {
      runtime.layerError = null;
      if (!theme || typeof theme.overrideTokens !== 'function') {
        runtime.layerError = '宿主没给配色通道，现在换不了皮肤';
        runtime.skinId = null;
        runtime.appliedCount = 0;
        runtime.spots = [];
        return false;
      }
      if (id === SKIN_NONE_ID) {
        if (layerDisposer) { layerDisposer(); layerDisposer = null; }
        runtime.skinId = SKIN_NONE_ID;
        runtime.appliedCount = 0;
        runtime.spots = [];
        runtime.scheme = snapshotOf(theme)?.active?.colorScheme ?? null;
        return true;
      }
      const skin = skinById(id);
      if (!skin) {
        runtime.layerError = `未知皮肤 ${id}（宿主表里没有这一张，不回落成默认值冒充）`;
        // 一个字节都没送出去，所以"当前生效"那三行账**不动**：上一次成功应用的那层还活着，
        // 把它清成"未应用"就是当着用户面报假数（界面会显示 0 处生效，可配色明明还改着）。
        return false;
      }
      const missing = Object.entries(skin.tokens).filter(([, v]) => !v || typeof v !== 'object'
        || typeof v.light !== 'string' || typeof v.dark !== 'string').map(([k]) => k);
      if (missing.length) {
        // 缺档不补：宿主明说两档都要，补一档等于把"切明暗就糊"的暗病藏到运行时。
        runtime.layerError = `皮肤 ${skin.id} 有 ${missing.length} 个令牌缺 light/dark 档，整层未应用：${missing.slice(0, 3).join(', ')}`;
        return false;
      }
      try {
        layerDisposer = theme.overrideTokens(SKIN_SOURCE, skin.tokens) ?? null;
        runtime.skinId = skin.id;
        runtime.appliedCount = Object.keys(skin.tokens).length;
        runtime.spots = spotCheck(theme, skin);
        return true;
      } catch (e) {
        // 宿主是在收层之前整体校验的（两档缺一即抛），抛了就没有半层这种东西：旧层照旧。
        runtime.layerError = `宿主拒了这层覆盖：${e?.message ?? e}`;
        return false;
      }
    }

    let layerDisposer = null;

    function snapshotOf(theme) {
      try {
        return typeof theme?.getTheme === 'function' ? theme.getTheme() : null;
      } catch {
        return null;
      }
    }

    /**
     * 抽查"我送进去的值宿主到底吃没吃"。判据取活动快照的 active.tokens —— 那是宿主
     * 折完所有覆盖层、按当前明暗档挑好之后的那份，也就是界面真正读到的那份。
     */
    function spotCheck(theme, skin) {
      const snap = snapshotOf(theme);
      const scheme = snap?.active?.colorScheme ?? null;
      runtime.scheme = scheme;
      if (!scheme) return [{ note: '读不到活动主题的 colorScheme，生效与否未确认' }];
      return SPOT_TOKENS.map((token) => {
        const modes = skin.tokens[token];
        const want = modes ? modes[scheme] : null;
        const got = snap.active.tokens ? snap.active.tokens[token] : null;
        return { token, want, got, ok: !!want && want === got };
      });
    }

    /* ------------------------------------------------------------
     * 3) brand 占位：按需注册 / 撤销（默认一格都不注册 = 原样）
     * ------------------------------------------------------------ */
    /** 图形色读 brand-primary、留白读 label-primary-inverted —— 这一对的对比度由 sk-10 卡着。 */
    const MARK_FG = 'var(--dsw-alias-brand-primary, currentColor)';
    const MARK_BG = 'var(--dsw-alias-label-primary-inverted, #fff)';

    function markShapes(id) {
      switch (id) {
        case 'ring':
          return [
            h('circle', { cx: 12, cy: 12, r: 8.4, fill: 'none', stroke: MARK_FG, 'stroke-width': 3.2 }),
            h('circle', { cx: 12, cy: 12, r: 2.6, fill: MARK_FG }),
          ];
        case 'diamond':
          return [
            h('path', { d: 'M12 2.4 21.6 12 12 21.6 2.4 12Z', fill: MARK_FG }),
            h('path', { d: 'M12 7.8 16.2 12 12 16.2 7.8 12Z', fill: MARK_BG }),
          ];
        case 'hex':
          return [
            h('path', { d: 'M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3Z', fill: MARK_FG }),
            h('circle', { cx: 12, cy: 12, r: 3.1, fill: MARK_BG }),
          ];
        case 'drop':
          return [
            h('path', { d: 'M12 2.8c4.2 4.6 6.3 7.9 6.3 10.6a6.3 6.3 0 1 1-12.6 0c0-2.7 2.1-6 6.3-10.6Z', fill: MARK_FG }),
            h('circle', { cx: 12, cy: 13.6, r: 2.7, fill: MARK_BG }),
          ];
        case 'spark':
          return [h('path', { d: 'M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z', fill: MARK_FG })];
        default: // 'letter'：圆角方块 + A
          return [
            h('rect', { x: 2, y: 2, width: 20, height: 20, rx: 6, fill: MARK_FG }),
            h('path', { d: 'M7 16.5 12 6l5 10.5h-3.1L12 11.6l-1.9 4.9z', fill: MARK_BG }),
          ];
      }
    }

    /**
     * 侧栏与首屏共用的标志组件。宿主按格给 `{size}`，尺寸跟着宿主走（折叠 rail 那格
     * 的 size 是真机量出来的未决项，spec §5-U7），这里不自定尺寸。
     *
     * `markId` / `imageUrl` / `mode` 三个入参只给选择器里的预览用（每张卡片要画**它自己**
     * 那一枚，不是当前生效的那枚）；槽位渲染时宿主不传，读 runtime.brand。
     */
    function BrandMark({ size, markId: pickId, imageUrl: pickUrl, mode: pickMode }) {
      const s = typeof size === 'number' ? size : 24;
      const { mode, markId, imageUrl } = runtime.brand;
      const useMode = pickMode ?? mode;
      const useMark = pickId ?? markId;
      const useUrl = pickUrl ?? imageUrl;
      if (useMode === BRAND_MODE_IMAGE && useUrl) {
        // 图片只走 <img src>：浏览器在 img 里不执行 SVG 内嵌脚本，也不让它去引用外部资源。
        // 换成 innerHTML 就等于把用户挑的文件当 HTML 注进宿主界面。
        return h('img', {
          src: useUrl, width: s, height: s, className: 'ap-mark-img', alt: '', draggable: false,
        });
      }
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, markShapes(useMark));
    }

    /**
     * 名称行那一格的渲染体。宿主对这一格只给 `{children?: never}` —— 内容与宽度全归占位者，
     * 所以我们自己画内容、自己收拾溢出（长名字走 ellipsis，不许把侧栏撑开）。
     * 颜色读宿主令牌：那格画在侧栏上，得跟着当前主题与皮肤走，不能写死。
     *
     * **图片优先于文字**（用户 2026-10-04 选定）：两个都在就画图。文字留在 runtime 里没被删，
     * 所以清掉图片那一格自己就回到那段文字 —— 选图不会让用户"刚打的字没了"。
     */
    function NameSlot() {
      const { nameImageUrl, name } = runtime.brand;
      if (nameArt() === 'image') {
        // 与 BrandMark 同一条红线：图片只走 <img src>，用户挑的文件绝不进 innerHTML
        // （SVG 里那段脚本在 img 里不会跑）。`alt` 用文字顶上，读屏软件与加载失败时都不空着。
        return h('img', {
          className: 'ap-brandimg', src: nameImageUrl, alt: name || '', draggable: false,
        });
      }
      if (!name) return null;
      return h('span', { className: 'ap-brandname', title: name }, name);
    }

    /**
     * 名称行那一格现在画的是什么：'image' | 'text' | null（null = 那一格归官方字标）。
     *
     * **由来源（`nameMode`）决定，不是"谁非空就画谁"** —— 用户下拉选了"文字"时，即使库里还躺着
     * 上次选的那张图，这一格也必须画字（他刚做的选择比旧的存货优先）。
     *
     * 选了"图片"却还没选到图时**降级**：有文字就画文字、没有就还给官方。理由有两条：
     * ① 不留一格空白（那一格空白会被宿主当成"没占位"，用户看到的是官方字标闪一下）；
     * ② 降级是**可解释**的 —— 界面上同时写着"还没选图片"，用户不会以为下拉坏了。
     */
    function nameArt() {
      const { nameMode, nameImageUrl, name } = runtime.brand;
      if (nameMode === NAME_SRC_IMAGE && nameImageUrl) return 'image';
      if (nameMode === NAME_SRC_OFF) return null;
      return name ? 'text' : null;
    }

    /**
     * 上一次选文件的结果**该不该显示**（纯函数：只读 runtime，不碰组件状态，所以离线可断言）。
     *
     * 用户 2026-10-04 报的正是这条规则没写：传完图又切回内置图标（星芒），
     * 那行「已裁成方形 · 从 3284KB 压到 77KB」还留在原地 —— 它说的是上一张图，
     * 跟当前选中的星芒一点关系都没有。
     *
     * 判据取"那一格现在画的**就是**这张处理出来的图"：
     *   · `mark` 那格：只有图片档还在用时算数（切回内置款式/原样就自动不算）；
     *   · `name` 那格：只有名称行**真在画图**时算数 —— 判据直接问 `nameArt()`，
     *     所以"切回自定义文字""清掉图片""选回官方字标"三条路径全都自动不算（下拉加了一项也不用回来改）。
     * 所以**任何一条路径都盖得住** —— 包括第七轮新加的那个"来源下拉"。反过来写
     * （在 chooseMark / chooseNameSource / 清图片里各自记得清一次）
     * 一定会漏掉某条路径 —— 这类"必须在每个动作里记得清"的写法在这个文件里已经犯过。
     */
    function noteVisible(note, target) {
      if (!note || note.target !== target) return false;
      if (target === LOGO_TARGET_NAME) return nameArt() === 'image';
      return runtime.brand.mode === BRAND_MODE_IMAGE;
    }

    /** 面板入口那枚图标固定：那是本插件自己的门牌，不跟着 brand 选择变。 */
    function PanelIcon({ size }) {
      const s = typeof size === 'number' ? size : 20;
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, markShapes('letter'));
    }

    /**
     * 已注册的格子 → `{dispose, sig}`。`sig` 是"这一格现在长什么样"的指纹（见 desiredBrandSlots）。
     * 撤销时逐个调用 `dispose()`，官方那条注册自己就回到渲染位。
     */
    const brandDisposers = new Map();
    let slotsRef = null;

    function clearBrand() {
      for (const entry of brandDisposers.values()) {
        try { entry.dispose(); } catch { /* 宿主已经收了这格就别再抛回去 */ }
      }
      brandDisposers.clear();
      runtime.brandRows = [];
    }

    /**
     * 当前**应该**占着的格子 → 组件。两类各自独立：
     *   ① 两格图标位 —— 看档位（mode !== off）；
     *   ② 名称行 —— 看那一格有没有内容（文字或图片，两者都是内容）。
     * 所以"只填名字、图标保持原样"与"只换图标、名字仍是官方"都能表达。
     */
    function desiredBrandSlots() {
      const want = new Map();
      if (runtime.brand.mode !== BRAND_MODE_OFF) {
        // 指纹带上所有决定"画出来长什么样"的输入：档位 / 款式 / 图片地址。
        const sig = `${runtime.brand.mode}|${runtime.brand.markId ?? ''}|${runtime.brand.imageUrl ?? ''}`;
        for (const slot of BRAND_MARK_SLOTS) want.set(slot, { component: BrandMark, sig });
      }
      const art = nameArt();
      if (art) {
        /**
         * 指纹 = **这一格画出来长什么样**，不多不少：
         *   · 画图时只带图片地址 —— 这时文字不参与渲染（`alt` 除外），带上它就会变成
         *     "改了文字、那张图白重挂一次"（重挂 = 图片重新请求，用户看得见一次闪）；
         *   · 画字时只带文字。
         * 少了图片地址那半边，就会变成"名称行换了张图但侧栏没动"（宿主只在注册表变化时重画）。
         *
         * 注意指纹里**没有 `nameMode`**，这是刻意的：指纹的语义是"这一格画出来长什么样"，
         * 而来源只是通往那个结果的一条路 —— 从「自定义文字」切到「自定义图片」但还没选到图时，
         * 这一格画的仍是同一段字，重挂一次只会让那张旧图白请求一遍。
         */
        const sig = art === 'image'
          ? `image|${runtime.brand.nameImageUrl ?? ''}`
          : `text|${runtime.brand.name ?? ''}`;
        want.set(BRAND_NAME_SLOT, { component: NameSlot, sig });
      }
      return want;
    }

    /**
     * 把该占的格占上、不该占的撤掉、**内容变了的重新占一遍**。可重复调用（幂等）。
     *
     * ## 为什么"内容变了"必须重挂（2026-10-04 真机踩出来的）
     *
     * 第五轮第一版为了"改名字时图标位不闪回官方"，把它写成了纯差集：已经在注册表里的格子
     * 一律不碰。结果用户报**「点了一枚图标，再点另一枚就不生效了」** —— 因为
     * **宿主只在「那一格的注册表发生变化」时才重画**，而我们的 `BrandMark` 读的是模块级
     * `runtime.brand`：我们这边改了，宿主根本不知道。于是第一枚（注册表从 0→2）能换上，
     * 之后再换任何一枚，注册表纹丝不动，侧栏就停在第一枚上。
     *
     * 所以"重挂"不是浪费，它是**唯一能把变化告诉宿主的手段**。指纹（`sig`）是这件事的粒度：
     * 换图标 ⇒ 图标位那两格的指纹变 ⇒ 只重挂那两格；改名字 ⇒ 只有名称行那格变 ⇒
     * 图标位一个字节都不动（既不闪回官方，也不做无谓的重挂）。
     *
     * 注册失败只记这一格的账，不牵连别格。
     */
    function syncBrand() {
      const want = desiredBrandSlots();
      // 先撤：不想要的格，以及**指纹变了**的格（后者撤完会在下面重新占上）。
      for (const [slot, entry] of [...brandDisposers]) {
        const next = want.get(slot);
        if (next && next.sig === entry.sig) continue;
        try { entry.dispose(); } catch { /* 宿主已经收了这格就别再抛回去 */ }
        brandDisposers.delete(slot);
      }
      runtime.brandRows = runtime.brandRows.filter((r) => want.has(r.slot));
      // 后占：该占、但还没占上的格（没声明的格子不碰 —— 真机对未声明的格子直接抛）。
      for (const [slot, entry] of want) {
        if (brandDisposers.has(slot) || !runtime.brandDeclared.has(slot)) continue;
        runtime.brandRows = runtime.brandRows.filter((r) => r.slot !== slot); // 同一格只留一条账
        try {
          const disposer = slotsRef.register({ name: slot, priority: BRAND_PRIORITY }, entry.component);
          brandDisposers.set(slot, { dispose: typeof disposer === 'function' ? disposer : () => {}, sig: entry.sig });
          runtime.brandRows.push({ slot, ok: true, priority: BRAND_PRIORITY });
        } catch (e) {
          runtime.brandRows.push({ slot, ok: false, priority: BRAND_PRIORITY, error: String(e?.message ?? e) });
        }
      }
    }

    /**
     * 换标志档位。图片那档的 URL 由宿主路由给（/api/logo），选完图片才调这里。
     * @returns {boolean} 档位是否被接受（未知档位不接受、也不动当前注册）
     */
    function setBrand(next) {
      const mode = next?.mode;
      if (!BRAND_MODES.includes(mode)) return false;
      if (mode === BRAND_MODE_BUILTIN && !markById(next.markId)) return false;
      if (mode === BRAND_MODE_IMAGE && !next.imageUrl) return false;
      runtime.brand = {
        mode,
        markId: mode === BRAND_MODE_BUILTIN ? next.markId : null,
        imageUrl: mode === BRAND_MODE_IMAGE ? next.imageUrl : null,
        // 名称行那三样（文字 / 来源 / 图片地址）都不归档位管：换图标不该顺手把用户写的名字、
        // 选的来源或挑的图抹掉。**这三个字段必须逐个显式接过来** —— 这里是整体重建对象，
        // 漏掉谁谁就变成 undefined（`nameMode` 第二版就是这么丢的，ap-52 当场咬住）。
        name: Object.hasOwn(next, 'name') ? next.name : runtime.brand.name,
        nameMode: runtime.brand.nameMode,
        nameImageUrl: runtime.brand.nameImageUrl,
        error: null,
      };
      syncBrand();
      return true;
    }

    /**
     * 把名称行那一格**整个**还给官方：文字与图片两头一起清。
     *
     * 为什么不能只清文字：那一格"图片优先" —— 图还在的话清完文字它照样画着图，
     * 用户点「还原官方」看到的是"按了没反应"（这正是把两个动作分开写最容易掉进去的坑）。
     * 单独的清图片入口不走这里（那时要保住文字，用户清完图看到的应该是他填的字）。
     */
    function clearNameArt() {
      runtime.brand.nameMode = NAME_SRC_OFF;
      runtime.brand.name = null;
      runtime.brand.nameImageUrl = null;
      syncBrand();
    }

    /**
     * 换名称行那一格的**来源**（下拉的三个选项，用户 2026-10-04 要求）。
     *
     * 三条路径各自做什么，以及为什么：
     *   · `off`   两头都清（这就是原来的「还原官方」，现在它是下拉里的一项）；
     *   · `text`  **只改来源** —— 图与地址一个字节不碰，所以从"图片"切过来再切回去，
     *             那一格立刻又能画回原来那张图（不用重选一次）。这正是"切走不毁数据"。
     *   · `image` 也**只改来源**。还没选到图时这一格会降级画文字/官方，界面上写明"还没选图片"，
     *             界面那边随后把文件选择器带出来（见 AppearancePage 的 chooseNameSource）。
     *
     * 落盘映射在 `persistBrand`：只有 `image` 会让 `nameImage` 变 true。
     * @param {'off'|'text'|'image'} next
     * @returns {boolean} 认这个取值就 true（不认识的取值不静默当成某一项）
     */
    function setBrandNameSource(next) {
      if (!NAME_SRC_LIST.includes(next)) return false;
      const b = runtime.brand;
      b.nameMode = next;
      // 只有"不用了"这两条会真的把内容扔掉；切到 text/image 一律保留两样存货。
      if (next === NAME_SRC_OFF) {
        b.name = null;
        b.nameImageUrl = null;
      }
      syncBrand();
      return true;
    }

    /**
     * 名称行那一格换成一张图。`null` = 清掉图片（那一格回到文字；没有文字就回到官方字标）。
     *
     * **不动文字**：`runtime.brand.name` 一个字节不碰 —— 这样"清掉图片"是纯本地的撤销，
     * 用户回到的是他原来那段字，不是空白。
     * 来源（`nameMode`）跟着这次结果走：拿到图当然就是"用图"；清掉图则退回"文字"（有字）
     * 或"官方字标"（没字）—— 不能停在"图片"这个来源上，否则下拉显示"自定义图片"而那一格
     * 画的却是文字，自相矛盾。
     * 换图必须重挂那一格（宿主只在注册表变化时重画），指纹里带着图片地址，`syncBrand` 自己会做。
     * @param {string|null} url 宿主路由给的地址
     */
    function setBrandNameImage(url) {
      const b = runtime.brand;
      b.nameImageUrl = url ? String(url) : null;
      if (b.nameImageUrl) b.nameMode = NAME_SRC_IMAGE;
      else if (b.nameMode === NAME_SRC_IMAGE) b.nameMode = b.name ? NAME_SRC_TEXT : NAME_SRC_OFF;
      syncBrand();
      return true;
    }

    /**
     * 改名称行那一格的文字。空白 / null = 把文字这一路清掉（那一格若还留着图且来源是"图片"，
     * 仍画图片；来源是"文字"而字清空了，那一格就自动还给官方字标）。
     * 超长在这侧当场拦住并报出字数 —— 宿主那道也会拒，但拒完用户只看到"没存住"，不如现在就说清。
     *
     * **不碰图片**：两样东西各存各的，所以改文字不会把用户挑的图弄丢，反之亦然。
     * 来源若还停在"官方字标"就顺手抬到"文字"：填了字却让下拉显示"官方字标"是自相矛盾的
     * （界面上下拉与输入框是配套的，正常走不到这条；这里是防御，免得将来多一个入口就漏）。
     * @returns {{ok: boolean, reason?: string}}
     */
    function setBrandName(text) {
      const raw = text === null || text === undefined ? '' : String(text);
      const name = raw.trim();
      if (name.length > BRAND_NAME_MAX) {
        return { ok: false, reason: `名称最多 ${BRAND_NAME_MAX} 个字，现在 ${name.length} 个` };
      }
      runtime.brand.name = name === '' ? null : name;
      if (runtime.brand.nameMode === NAME_SRC_OFF) runtime.brand.nameMode = NAME_SRC_TEXT;
      syncBrand();
      return { ok: true };
    }

    /**
     * 存档带回来的标志选择（图片那两档要用宿主给的地址）。
     * 存档说有图但没给地址（多半是路由没起来）就当没这档，保持原样 —— 不画一条断链。
     *
     * 名称行**先落且独立**：图标那档可能因为缺图片地址而不成立，名称行不该跟着一起丢；
     * 名称行自己那两张脸也各自独立（有文字没图、有图没文字、两样都有，都是合法组合）。
     */
    function bootBrand() {
      const b = runtime.boot?.brand;
      const bootNameLogo = runtime.boot?.nameLogoUrl ?? null;
      if (!b && !bootNameLogo) return;
      if (bootNameLogo) runtime.brand.nameImageUrl = String(bootNameLogo);
      if (typeof b?.name === 'string' && b.name.trim()) runtime.brand.name = b.name.trim();
      /**
       * 恢复"那一格用的是哪个来源"。存档里只有 `nameImage` 这个 0/1 以及 `name` 有没有值，
       * 所以三种来源里能无损还原的只有两态：
       *   · `nameImage === true`  ⇒ 用户上次选的是「自定义图片」（哪怕图上没落住，也尊重他的选择）；
       *   · 否则有名字 ⇒ 「自定义文字」；连名字都没有 ⇒ 「官方字标」。
       * 唯一的损失是"选了文字但还没填字"这种**中间态** —— 它重启后会显示成「官方字标」，
       * 而两者画出来的东西本来就一模一样（都是官方字标），不构成欺骗。
       */
      runtime.brand.nameMode = b?.nameImage === true
        ? NAME_SRC_IMAGE
        : (runtime.brand.name ? NAME_SRC_TEXT : NAME_SRC_OFF);
      if (!b) { syncBrand(); return; }
      if (b.mode === BRAND_MODE_IMAGE && !runtime.boot?.logoUrl) {
        // 存档说有图但地址没给（多半是那条路由没起来）：图标保持原样，名称行照落。
        syncBrand();
        return;
      }
      setBrand({ mode: b.mode, markId: b.markId, imageUrl: runtime.boot?.logoUrl ?? null });
    }

    /**
     * 开局读一次存档。**默认值是"原样"，存档只是覆盖它**，所以这条请求失败不影响界面可用：
     * 顶多这一次重启前的选择没恢复回来，而界面上会把原因写出来。
     */
    async function loadPrefs() {
      if (!cfg().api) return;
      try {
        const r = await fetch(`${cfg().api}/prefs`);
        const j = await r.json().catch(() => null);
        if (!j?.ok) {
          runtime.storeNote = `${j?.error?.message ?? `读存档失败（HTTP ${r.status}）`} —— 这次进来是原样`;
          return;
        }
        runtime.boot = j.data;
        runtime.bootLoaded = true;
        if (runtime.userChose) return; // 用户已经点过，迟到的存档不许盖掉他的选择
        bootBrand();
        applySkin(themeRef, bootSkinId());
        postReport();
      } catch (e) {
        runtime.storeNote = `读存档这一步断了：${e?.message ?? e} —— 这次进来是原样`;
      }
    }

    /* ------------------------------------------------------------
     * 4) 面板
     * ------------------------------------------------------------ */
    /** 宿主存储那边回来的坏消息 + 这一轮写存档的失败，都要在界面上看得见（别静默回落成"以为记住了"）。 */
    function storeNote() {
      if (runtime.storeNote) return runtime.storeNote;
      const s = cfg().store;
      if (!s) return null;
      if (s.available === false) return s.message || '这台机器上存不住 —— 重启后回到原样';
      return null;
    }

    function Disclosure() {
      return h('div', { className: 'ap-disclosure' },
      h('p', {}, '本插件只改这个应用长什么样：配色经宿主的 ctx.theme 覆盖层，标志经宿主的 brand slot。不写宿主文件、不注入全局 CSS、不碰你的系统。'),
      h('p', {}, '边界就地写明：① 刚进来是原样 —— 配色和标志都要你点过才动，点过的选择存在宿主那边，下次重启自动恢复；② 内置「设置 → 通用 → 外观」那一行仍只有 明亮 / 暗黑 / 跟随系统，本插件的覆盖层叠在它上面，两档都跟着切；③ 每张皮肤只覆盖 24 个令牌，真令牌共 117 个，其余 93 个露出内置配色；④ 侧栏那行字标（deepseek / HARNESS）要你在「名称行」里填字、或者给它选一张图才换，两样都没有就是官方字标（两样都有时画图，点「清掉图片」回到你填的字）；⑤ 标题栏与任务栏上那个名字是构建期常量、exe 与托盘图标是安装目录里的文件，这两样不在插件权限内。'));
    }

    /** 两格标志位给用户看的名字（slot 名留在 runtime 与回报里，界面上不出现）。 */
    const BRAND_SLOT_LABELS = {
      'sidebar.brand.mark': '侧栏图标',
      'sidebar.brand.name': '名称行',
      'conversation.hero.brand.mark': '会话首屏',
    };
    /** 抽查那三个令牌给用户看的名字（令牌名留在 runtime 与回报里，界面上不出现 `--dsw-*`）。 */
    const SPOT_LABELS = {
      '--dsw-alias-bg-base': '页面底色',
      '--dsw-alias-label-primary': '正文字色',
      '--dsw-alias-brand-primary': '强调色',
    };
    const SCHEME_LABELS = { light: '明亮', dark: '暗黑' };

    /** 名称行那一句人话（两处摘要都用它，省得同一个事实有两种说法）。 */
    function nameBit() {
      // 图片在时只报"是图片"：24 字的名字塞进页头那行会把另两个 chip 挤到第二行去，
      // 而图片档压根没有名字可说（文字虽然留着，但那一格现在画的不是它）。
      if (runtime.brand.nameImageUrl) return '名称行已换成你自己的图片';
      const name = runtime.brand.name;
      return name ? `名称行已换成「${name}」` : null;
    }

    function brandSummary() {
      const { mode, markId } = runtime.brand;
      const bit = nameBit();
      if (mode === BRAND_MODE_OFF) return bit ?? '原样（本插件没换）';
      const what = mode === BRAND_MODE_IMAGE ? '你选的图片' : `内置 · ${markById(markId)?.name ?? markId}`;
      const suffix = bit ? `；${bit}` : '';
      // "占上没占上"是这一格唯一的悬念（宿主没声明那几格时就一直占不上），所以就近说出来。
      if (runtime.brandRows.length === 0) return `${what} —— 还没占上位（等宿主声明那几格）${suffix}`;
      if (runtime.brandRows.every((r) => r.ok)) {
        return `${what}（侧栏图标、会话首屏${nameArt() ? '、名称行' : ''}）${suffix}`;
      }
      const bad = runtime.brandRows.filter((r) => !r.ok).map((r) => `${BRAND_SLOT_LABELS[r.slot] ?? r.slot}：没换成 —— ${r.error}`).join('；');
      return `${what} —— ${bad}${runtime.brandRows.some((r) => r.ok) ? '；其余已换上' : ''}${suffix}`;
    }

    /**
     * 页头那行摘要用的短名（逐格报错与长解释留给 brandSummary）。
     * 名称行这里只报"换了没换、换的是哪样"，**不把名字本身摆上来** —— 名称上限 24 字，
     * 塞进页头那行会把另外两个 chip 挤到第二行去。
     */
    function brandLabel() {
      const { mode, markId } = runtime.brand;
      const art = nameArt();
      const tail = art === 'image' ? ' · 名称行图片' : art === 'text' ? ' · 名称已换' : '';
      if (mode === BRAND_MODE_OFF) return (art ? `图标原样${tail}` : '原样（官方图标）');
      const what = mode === BRAND_MODE_IMAGE ? '你自己的图片' : `内置 · ${markById(markId)?.name ?? markId}`;
      if (!runtime.brandRows.length) return `${what} · 还没占上位${tail}`;
      return `${what} · ${runtime.brandRows.filter((r) => r.ok).length} 格${tail}`;
    }
    function skinLabel() {
      if (!runtime.skinId || runtime.skinId === SKIN_NONE_ID) return '不覆盖（内置配色）';
      const name = skinById(runtime.skinId)?.name ?? `未知（${runtime.skinId}）`;
      return `${name} · ${runtime.appliedCount} 处`;
    }

    /**
     * 页头：标题 + 一行「现在是什么状态」的摘要。
     *
     * 这一行同时是**操作的反馈落点**（用户红线：不许浮层提示条）。点一张皮肤，这里的名字与处数当场变；
     * 存档写失败、配色没生效、标志没换上，也全部落在这里 —— 不再让人滚到页面最底下才发现出错。
     */
    function Head() {
      const notes = [];
      if (!runtime.themeReady) notes.push(['ch', '配色通道未就绪 —— 现在点哪张都不会变']);
      if (runtime.layerError) notes.push(['layer', runtime.layerError]);
      if (runtime.brand.error) notes.push(['brand', runtime.brand.error]);
      const note = storeNote();
      if (note) notes.push(['store', note]);
      return h('div', { className: 'ap-head' },
      h('h2', { className: 'ap-title' }, '桌面外观'),
      h('div', { className: 'ap-status' },
        h('span', { className: 'ap-chip' }, h('span', {}, '配色'), h('b', {}, skinLabel())),
        h('span', { className: 'ap-chip' }, h('span', {}, '明暗'), h('b', {}, SCHEME_LABELS[runtime.scheme] ?? '未确认')),
        h('span', { className: 'ap-chip' }, h('span', {}, '标志'), h('b', {}, brandLabel()))),
      notes.length === 0 ? null : h('div', { className: 'ap-notices' },
        notes.map(([key, text]) => h('p', { key, className: 'ap-notice ap-err' }, text))));
    }

    /**
     * 「界面实际读到的配色」—— 抽查那三行的落点。
     * 默认态（一张皮肤都没叠）整块不渲染：页头那行摘要已经说清了"配色：不覆盖"，
     * 再摆一张空卡就是噪音。套了层才出现，出现即是有话要说。
     */
    function StatusCard() {
      const spots = runtime.spots;
      if (!spots.length) return null;
      return h('div', { className: 'ap-checks' },
      h('div', { className: 'ap-checks-h' }, '界面实际读到的配色'),
      h('div', { className: 'ap-spots' }, spots.map((s, i) => (s.note
        ? h('span', { key: i, className: 'ap-spot ap-err' }, '读不到当前明暗档，无法核对')
        : h('span', { key: i, className: 'ap-spot' },
          h('span', { className: 'ap-muted' }, SPOT_LABELS[s.token] ?? s.token),
          h('span', { className: s.ok ? 'ap-ok' : 'ap-err' },
            s.ok ? `已生效 ${s.want}` : `没生效 —— 界面读到的是 ${s.got ?? '（空）'}`))))));
    }

    function SectionHead({ title, hint }) {
      return h('div', { className: 'ap-sec' },
      h('div', { className: 'ap-sec-h' }, title),
      hint ? h('p', { className: 'ap-sec-note' }, hint) : null);
    }

    /**
     * 一组单选方片的键盘口径（WAI-ARIA radiogroup）：方向键在组内循环移动并当场选中，焦点跟着走。
     * 少了这一步，`role="radio"` 对着读屏软件就是一句谎话 —— 说"这是单选框"却按不动。
     * ids 的顺序就是视觉顺序；picked 传回来的是那一项的 id。
     */
    function radioKeys(e, ids, cur, pick) {
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
        : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
      if (step === 0) return;
      const at = ids.indexOf(cur);
      if (at < 0) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const next = ids[(at + step + ids.length) % ids.length];
      pick(next);
      const doc = globalThis.document;
      if (doc && typeof doc.querySelector === 'function') {
        const el = doc.querySelector(`[data-ap-id="${next}"]`);
        if (el && typeof el.focus === 'function') el.focus();
      }
    }

    /**
     * 选中角标（主题色圆底 + 反白勾）；只画在生效的那一张上。 */
    function CheckMark() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', { d: 'M4 8.4 6.7 11 12 5.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }

    /** 「原样」那一枚的图标：一条回转箭头（"官方那枚回来"），走 currentColor 保持中性灰。 */
    function OffMark() {
      return h('svg', { width: 26, height: 26, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('path', { d: 'M4.6 10.2a7.8 7.8 0 1 1 1.9 6.1', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.1, 'stroke-linecap': 'round' }),
        h('path', { d: 'M3.4 4.4v5.8h5.8', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }

    /** 标志那一区：一排可点的方片（原样 + 六款内置）+ 一格"你自己的图片"。
     *
     * 版式与交互的取舍（2026-10-03 第四轮重做）：以前是 8 张大卡片、每张卡里一个黑实心按钮，
     * 一屏压了十几个同权重的黑块，既吵又要瞄准那个小按钮才点得动。现在**整片可点**，
     * 按钮没了 —— 选中态就在方片自己身上（主题色描边 + 角标），一次点击到位。
     * 图片那格是 `<label>` 包着隐藏的 file input：整格点哪儿都开文件选择器。
     *
     * 名称行那一格（2026-10-04 第六轮起）能放**两样东西**：文字与图片。第七轮按用户要求把
     * "这一格用哪个"做成了**下拉**（官方字标 / 自定义文字 / 自定义图片），选哪个就出现哪一组操作 ——
     * 以前四个入口平铺在一行，用户得自己先看懂"哪几个现在是活的"。
     * 两样东西**各存各的**，切走不毁数据：从"图片"切到"文字"再切回来，那张图立刻又画得上；
     * 只有「清掉图片」与「官方字标」会真的把地址清掉。
     * 图片那一路同样是 `<label>` + 隐藏 input，只是落点换成了 `?which=name` 那一条。
     */
    function LogoSection({
      onPick, onMarkFile, busy, markError, markNote,
      nameDraft, nameMsg, onNameDraft, onNameApply, onNameSource,
      onNameFile, onNameClear, nameImageNote, nameImageError,
    }) {
      const { mode, markId, imageUrl: pickedUrl, nameImageUrl, nameMode } = runtime.brand;
      const anyBusy = Boolean(busy);
      const nameBusy = busy === LOGO_TARGET_NAME;
      /** 方向键的顺序 = 视觉顺序（图片那格自成一类控件，不进这组 radio）。 */
      const ids = ['off', ...markList().map((m) => m.id)];
      /**
       * 名称行的输入框口径：`nameDraft === null` = 用户还没编辑过，**显示当前生效的名字**。
       * 这样存档异步回来改名时输入框会跟着走，而用户敲过的草稿不会被覆盖。
       */
      const nameCurrent = runtime.brand.name ?? '';
      const nameShown = nameDraft ?? nameCurrent;
      const nameDirty = nameShown.trim() !== nameCurrent;
      /**
       * 下拉的当前值就是来源本身（**不是从"有没有内容"反推**）：用户选了「自定义图片」而图还没到，
       * 下拉必须停在「自定义图片」上 —— 否则他一选就被弹回上一项，看着像点坏了。
       */
      const nameSrc = nameMode;
      /** 当前来源该给哪些控件（三选一，永远只有一组）。 */
      const nameOps = nameSrc === NAME_SRC_TEXT
        ? [
          h('input', {
            key: 'i', id: 'ap-name-i', className: 'ap-name-i', type: 'text',
            maxLength: BRAND_NAME_MAX, disabled: anyBusy,
            placeholder: `最多 ${BRAND_NAME_MAX} 个字`,
            value: nameShown,
            onInput: (e) => onNameDraft(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault?.(); onNameApply(); } },
          }),
          h('button', {
            key: 'b', type: 'button', className: 'ap-name-b', 'data-ap-id': 'name-apply',
            // 没改就不给按：按了也不会有事发生，禁掉省得用户以为坏了（禁用态只退文字色、留着边框）。
            disabled: anyBusy || !nameDirty,
            onClick: () => onNameApply(),
          }, '用这个'),
        ]
        : nameSrc === NAME_SRC_IMAGE
          ? [
            h('label', {
              key: 'p', className: `ap-name-b ap-name-pick${nameImageUrl ? ' ap-on' : ''}`,
              'data-ap-id': 'name-image',
            },
              nameImageUrl
                ? h('img', { className: 'ap-name-thumb', src: nameImageUrl, alt: '', draggable: false })
                : null,
              nameBusy ? '处理中…' : (nameImageUrl ? '换一张图' : '选图片'),
              h('input', {
                // 隐藏的文件入口，整块 `<label>` 包着它：点「选图片/换一张图」才弹文件框，
                // 选「自定义图片」这个来源本身**不弹**（用户 2026-10-04 要求）。
                type: 'file', className: 'ap-file', accept: 'image/*',
                disabled: anyBusy,
                onChange: (e) => onNameFile(e.target?.files?.[0]),
              })),
            nameImageUrl
              ? h('button', {
                key: 'c', type: 'button', className: 'ap-name-b', 'data-ap-id': 'name-image-clear',
                disabled: anyBusy, onClick: () => onNameClear(),
              }, '清掉图片')
              : null,
          ]
          : [];
      /**
       * 每个来源都有一句就地说明 —— 这一格最容易让人犯糊涂的地方正是"我选的和我看到的不一样"：
       * 选了图片却还没选到图时，这一格降级画的是文字（或官方字标），不说明白就是一句谎话。
       */
      const nameHint = nameSrc === NAME_SRC_OFF
        ? '这一格用 dsh 自带的字标；想换就选「自定义文字」或「自定义图片」。'
        : nameSrc === NAME_SRC_TEXT
          ? '这一格画的是你填的字；清空就等于还给官方字标。'
          : (nameImageUrl
            ? `这一格画的是上面那张图；点「清掉图片」${nameCurrent ? `回到你填的文字「${nameCurrent}」` : '还给官方字标'}。`
            : `还没选图片 —— 这一格现在${nameCurrent ? `画的是你填的文字「${nameCurrent}」` : '仍是官方字标'}，选一张图就换上。`);
      const tile = (key, on, body) => h('button', {
        key, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
        className: `ap-mark${on ? ' ap-on' : ''}`, 'data-ap-id': key,
        onClick: () => onPick(key),
        onKeyDown: (e) => radioKeys(e, ids, key, onPick),
      }, body);
      /** 名字在下面，图标在上面：方片只有 76px 宽，长名字靠 ellipsis 兜着，不让它撑破对齐。 */
      const name = (key, text) => h('span', { key, className: 'ap-mark-name' }, text);
      return h('div', { className: 'ap-marks' },
      h('div', { className: 'ap-mark-radios', role: 'radiogroup', 'aria-label': '标志' },
        tile('off', mode === BRAND_MODE_OFF, [
          h('span', { key: 'i', className: 'ap-mark-off' }, h(OffMark)),
          name('n', '原样'),
        ]),
        ...markList().map((m) => tile(m.id, mode === BRAND_MODE_BUILTIN && markId === m.id, [
          h('span', { key: 'i', className: 'ap-preview' },
            h(BrandMark, { size: 34, mode: BRAND_MODE_BUILTIN, markId: m.id })),
          name('n', m.name),
        ]))),
      h('label', { className: `ap-mark ap-mark-upload${mode === BRAND_MODE_IMAGE ? ' ap-on' : ''}` },
        h('span', { className: `ap-thumb${pickedUrl ? ' ap-thumb-set' : ''}` },
          pickedUrl
            ? h(BrandMark, { size: 34, mode: BRAND_MODE_IMAGE, imageUrl: pickedUrl })
            : h('span', { className: 'ap-thumb-plus' }, '+')),
        name('n', busy === LOGO_TARGET_MARK ? '处理中…' : (mode === BRAND_MODE_IMAGE ? '换一张' : '选图片')),
        // 收得宽：反正后端会重编码，挑哪种格式进来都行（SVG 那档会原样保留矢量）。
        h('input', {
          type: 'file', className: 'ap-file', accept: 'image/*', disabled: anyBusy,
          onChange: (e) => onMarkFile(e.target?.files?.[0]),
        })),
      h('p', { key: 'lim', className: 'ap-marks-note ap-muted' },
        `支持的图片：${LOGO_ALLOWED_MIMES.map((m) => LOGO_MIME_LABELS[m] ?? m).join(' / ')}（GIF、BMP 这些也能选，会自动转成 WebP 或 JPEG）；单张不超过 ${Math.round(LOGO_MAX_SOURCE_BYTES / 1024 / 1024)}MB，选进来会自动压到 ${Math.round(LOGO_MAX_BYTES / 1024)}KB 以内 —— 图标位裁成方形，名称行那张按原比例缩`),
      // 处理结果就落在这里（绿 = 成了、红 = 没成）。**那行绿字只在"这张图真的还在用"时出现**：
      // 切回内置图标之后它就该消失（用户 2026-10-04 报的正是它一直挂着，规则在 noteVisible 里）。
      markNote ? h('p', { key: 'ok', className: 'ap-marks-err ap-ok' }, markNote) : null,
      markError ? h('p', { key: 'err', className: 'ap-marks-err ap-err' }, markError) : null,
      // 名称行：跟图标位同住一小节，但它自成一套控件 —— 换不换图标都不影响这里（反之亦然）。
      // 那一格有两张脸（文字 / 图片），各一个入口；哪个在生效就在哪个上面点着选中态。
      h('div', { key: 'name', className: 'ap-name' },
        // 第一组：**选这一格用哪个来源**。三个选项就是那一格的三种状态，选了它才出现对应的操作 ——
        // 以前四个入口（输入框 / 用这个 / 还原官方 / 选图片）平铺在一行，用户得自己先看懂
        // "哪几个现在是活的"，而它们其实分属两种互斥的用法。
        h('span', { className: 'ap-name-grp' },
          h('label', { className: 'ap-name-l', htmlFor: 'ap-name-src' }, '名称行'),
          h('span', { className: 'ap-name-selwrap' },
            h('select', {
              id: 'ap-name-src', className: 'ap-name-sel', 'data-ap-id': 'name-src',
              value: nameSrc, disabled: anyBusy,
              onChange: (e) => onNameSource(e.target.value),
            },
              ...NAME_SRC_LIST.map((v) => h('option', { key: v, value: v }, NAME_SRC_LABELS[v]))))),
        // 第二组：**当前来源需要的操作**。三个来源互斥，所以这里永远只有一组。
        // 窄面板放不下时整组自己换行（外面是 flex-wrap），不会被拆成两半。
        h('span', { className: 'ap-name-grp' }, ...nameOps),
        // 就地说明：这一格现在到底画的是什么、下一步该干嘛。**每个来源都有话可交代** ——
        // 包括"选了图片但还没选到图"这种中间态（不然用户会以为下拉点坏了）。
        nameHint ? h('p', { key: 'hint', className: 'ap-name-hint ap-muted' }, nameHint) : null,
        nameMsg ? h('span', { key: 'msg', className: `ap-name-msg ${nameMsg.ok ? 'ap-ok' : 'ap-err'}` }, nameMsg.text) : null,
        nameImageNote ? h('span', { key: 'nok', className: 'ap-name-msg ap-ok' }, nameImageNote) : null,
        nameImageError ? h('span', { key: 'nerr', className: 'ap-name-msg ap-err' }, nameImageError) : null));
    }

    /* ---------------- 图片：自动裁成方形 + 压到 200KB 以内 ----------------
     * 用户 2026-10-04 提的：传一张随便多大的图，能不能自动裁好压好再存。
     * 全在浏览器半边做（canvas 是原生能力，不引任何依赖），宿主那道 200KB 的闸一个字不改
     * —— 压缩后送和手动换小图走的是同一道门，"这条路由谁都能调"的防线不能松。
     */

    /**
     * 居中 cover 的源矩形：把 w×h 裁成正方形 —— 短边全用，长边两边各切掉一半。
     * 纯几何、无副作用，所以能离线断言（真机那半边的 canvas 在 Node 里跑不起来，
     * 这条是这套管线里唯一测得动的部分，也因此更要测）。
     * @returns {{x:number,y:number,s:number}}
     */
    function coverRect(w, h) {
      const s = Math.min(w, h);
      return { x: Math.round((w - s) / 2), y: Math.round((h - s) / 2), s: Math.round(s) };
    }

    function readAsDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('文件没读出来'));
        reader.readAsDataURL(blob);
      });
    }

    /**
     * 解码成能画进 canvas 的东西。用 `createImageBitmap` —— Electron 渲染进程一定有，
     * 而且它顺手按 EXIF 把朝向摆正（手机竖拍的照片不会躺着进来）。
     * 拿不到就直说不支持，不退回 `new Image()` 那条更绕的路（那条还得自己管 objectURL 的回收）。
     */
    async function decodeImage(file) {
      if (typeof globalThis.createImageBitmap !== 'function') {
        throw new Error('这台机器上不支持自动裁图，请换一张 200KB 以内的方图');
      }
      try {
        return await globalThis.createImageBitmap(file);
      } catch {
        throw new Error('这张图画不出来（文件可能坏了，或者根本不是图片）');
      }
    }

    function canvasToBlob(canvas, mime, quality) {
      return new Promise((resolve) => {
        try { canvas.toBlob((b) => resolve(b ?? null), mime, quality); } catch { resolve(null); }
      });
    }

    /**
     * 抽样看这张图有没有真透明（每 17 个像素查一个，够用且不卡）。读不到像素就当不透明。
     * 按**宽高**取样、不假设是正方形 —— 名称行那张是横长条（第一版写死 `side` 就只能测方的）。
     */
    function hasAlpha(ctx, w, h) {
      try {
        const d = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < d.length; i += 4 * 17) if (d[i] < 250) return true;
      } catch { /* 保守走 JPEG */ }
      return false;
    }

    /** 沿质量阶梯找一个压到上限以内的成品；整条阶梯都不行就交回最小的那张（由调用方降分辨率再试）。 */
    async function encodeUnderLimit(canvas, mime) {
      let smallest = null;
      for (const q of LOGO_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, mime, q);
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= LOGO_MAX_BYTES) return blob;
      }
      return smallest;
    }

    /**
     * 把用户挑的文件收拾成"能存进去、也画得好看"的一张小图。
     *
     * 三条路线：
     *   ① **SVG 且不超上限** ⇒ 原样直送。矢量图任何尺寸都清晰，位图化只会把它弄糊
     *      （超上限的 SVG 多半已经内嵌了大位图，那时它本来就不是矢量了，按位图处理）。
     *   ② 位图 ⇒ 按**那一格的口径**定形状（`SHAPE_OF`）：图标位居中裁成正方形 + 缩到 512；
     *      名称行**不裁**、按原比例缩进 512×160 的框（那一格是横长条，裁方等于把图毁了）。
     *      **只缩不放大**，小图不会被拉糊；再沿质量阶梯压到上限以内。
     *   ③ 有透明出 WebP（保 alpha），不透明出 JPEG（兼容最好）。
     *
     * 兜底两道：压完反而更大、而原图本来就合规**且形状一点没动过** ⇒ 用原图（不做无谓的重编码）；
     * 尺寸对半后仍压不进 200KB（纯噪点大图才可能）⇒ 再走一遍阶梯。
     *
     * @param {File|Blob} file
     * @param {'mark'|'name'} [target] 进哪一格 —— 只影响"裁不裁、框多大"，编码那半段两格完全共用
     * @returns {Promise<{dataUrl:string,mime:string,bytes:number,note:string}>} note 是要就地显示给用户的一句话
     */
    async function shrinkImage(file, target = LOGO_TARGET_MARK) {
      const shape = SHAPE_OF[target] ?? SHAPE_OF[LOGO_TARGET_MARK];
      const type = String(file?.type ?? '');
      const fromKB = Math.max(1, Math.round(file.size / 1024));
      if (type === 'image/svg+xml' && file.size <= LOGO_MAX_BYTES) {
        return { dataUrl: await readAsDataUrl(file), mime: type, bytes: file.size, note: `矢量图原样保留 · ${fromKB}KB` };
      }
      const bmp = await decodeImage(file);
      const srcW = Number(bmp.width) || 0;
      const srcH = Number(bmp.height) || 0;
      if (!srcW || !srcH) { bmp.close?.(); throw new Error('这张图的尺寸读不出来'); }

      // 源矩形：要裁方就是居中取正方形（`coverRect` 的几何，短边全用、长边两边各切一半）；
      // 不裁就是整张。**统一成 {x,y,w,h}**，后面画的时候只有一份代码。
      const cover = shape.crop ? coverRect(srcW, srcH) : null;
      const box = cover
        ? { x: cover.x, y: cover.y, w: cover.s, h: cover.s }
        : { x: 0, y: 0, w: srcW, h: srcH };
      const cropped = !!cover && (box.w !== srcW || box.h !== srcH);

      // 目标尺寸：只缩不放大；两个上限同时管（先撞哪个由原图比例决定）。
      const k = Math.min(1, shape.maxW / box.w, shape.maxH / box.h);
      let tw = Math.max(1, Math.round(box.w * k));
      let th = Math.max(1, Math.round(box.h * k));
      const resized = tw !== box.w || th !== box.h;

      let canvas = globalThis.document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const paint = (at, w, h) => {
        const g = at.getContext('2d');
        if (!g) throw new Error('这台机器上画不了图（拿不到 canvas 2d）');
        g.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, w, h);
        return g;
      };
      let ctx = paint(canvas, tw, th);
      const transparent = type !== 'image/jpeg' && hasAlpha(ctx, tw, th);
      const mime = transparent ? 'image/webp' : 'image/jpeg';

      let blob = await encodeUnderLimit(canvas, mime);
      // 还压不下去就尺寸对半再来一遍（拿已经画好的那张缩，不碰原图）。
      if (blob && blob.size > LOGO_MAX_BYTES && Math.max(tw, th) > 64) {
        const sw = Math.max(1, Math.round(tw / 2));
        const sh = Math.max(1, Math.round(th / 2));
        const c2 = globalThis.document.createElement('canvas');
        c2.width = sw; c2.height = sh;
        const g2 = c2.getContext('2d');
        if (g2) {
          g2.drawImage(canvas, 0, 0, tw, th, 0, 0, sw, sh);
          const again = await encodeUnderLimit(c2, mime);
          if (again && again.size < blob.size) { blob = again; canvas = c2; tw = sw; th = sh; ctx = g2; }
        }
      }
      bmp.close?.();

      // 压完更大、而原图本来就合规、**形状也没被我们改过** ⇒ 用原图，省掉这次没意义的重编码。
      // "形状没被改过"两格各是一条：图标位看"没裁过"（裁了就不能用原图，那是方的）；
      // 名称行看"缩都没缩过"（原图本来就在框里）—— 4K 方图缩到 160 之后如果还用原图，
      // 就是让浏览器为一行 20px 的字标去解码一千六百万像素，那条兜底反而成了性能坑。
      const fitsSlot = shape.crop ? !cropped : !resized;
      if (blob && blob.size > file.size && file.size <= LOGO_MAX_BYTES && fitsSlot) {
        return { dataUrl: await readAsDataUrl(file), mime: type, bytes: file.size, note: `原图已够小，原样保留 · ${fromKB}KB` };
      }
      if (!blob) throw new Error('这张图压不出成品（这台机器不支持这个格式的编码）');
      const toKB = Math.max(1, Math.round(blob.size / 1024));
      const bits = [];
      if (cropped) bits.push('已裁成方形');
      else if (resized) bits.push(`按原比例缩到 ${tw}×${th}`);
      if (blob.size < file.size) bits.push(`从 ${fromKB}KB 压到 ${toKB}KB`);
      if (!bits.length) bits.push(`${toKB}KB`);
      return { dataUrl: await readAsDataUrl(blob), mime, bytes: blob.size, note: bits.join(' · ') };
    }

    /**
     * 选文件 → 按那一格的口径收拾好（裁/缩 + 压到 200KB 以内）→ 交给宿主存 →
     * 拿回图片地址并让那一格画上它。
     *
     * 两个去处**只有落点不同**：送上去的这道门（宿主重新验类型与大小）一个字都没放松，
     * 所以"名称行的图放行得更宽"这种情况不存在（hs-27 是它宿主那一侧的替身）。
     *
     * @param {File|Blob} file
     * @param {'mark'|'name'} target `mark` = 两格图标位；`name` = 名称行那一格
     * @param {(err: string|null, note?: string) => void} [after] 结果就地回报（错误与"处理成了什么样"各一路）
     */
    async function uploadImage(file, target, after) {
      if (!file) return;
      if (!LOGO_TARGETS.includes(target)) {
        // 不静默当成 mark：那会把"名称行的图"存到图标位上，而用户还以为成了。
        after?.(`不知道该把这张图放到哪一格：${String(target)}`);
        return;
      }
      if (!String(file.type || '').startsWith('image/')) {
        after?.(`这个不是图片：${file.type || '未知类型'}`);
        return;
      }
      if (file.size > LOGO_MAX_SOURCE_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        after?.(`这张 ${mb}MB，超过 ${Math.round(LOGO_MAX_SOURCE_BYTES / 1024 / 1024)}MB —— 先自己裁一下再传`);
        return;
      }
      let prepared;
      try {
        prepared = await shrinkImage(file, target);
      } catch (e) {
        after?.(String(e?.message ?? e));
        return;
      }
      try {
        const url = `${cfg().api}/logo${target === LOGO_TARGET_NAME ? `?which=${LOGO_TARGET_NAME}` : ''}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mime: prepared.mime, dataUrl: prepared.dataUrl }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j?.ok || !j.data?.url) {
          after?.(`宿主没收这张图：${j?.error?.message ?? `HTTP ${r.status}`}`);
          return;
        }
        runtime.userChose = true;
        if (target === LOGO_TARGET_NAME) {
          /**
           * 名称行那条支线：图片字节落在 logo 表自己那一行，**开关由路由那一步一起点上**
           * （见 lib/api.js 里写 logo 之后那次 writePrefs）—— 所以这里不再多发一条 prefs，
           * 只把"这个字段我们知道它的值了"记上，供以后任何一次 persistBrand 用。
           */
          runtime.imageTouched = true;
          setBrandNameImage(j.data.url);
          postReport();
          const on = runtime.brandRows.some((r) => r.slot === BRAND_NAME_SLOT && r.ok);
          after?.(on ? null : '名称行那一格宿主还没声明，图存下了但这轮画不出来', prepared.note);
          return;
        }
        runtime.markTouched = true;
        if (!setBrand({ mode: BRAND_MODE_IMAGE, imageUrl: j.data.url })) {
          after?.('标志档位没切过去（宿主那几格可能还没声明）');
          return;
        }
        persistBrand();
        postReport();
        after?.(null, prepared.note);
      } catch (e) {
        after?.(`送图这一步断了：${e?.message ?? e}`);
      }
    }

    /**
     * 一张皮肤的预览块：拿这张皮肤自己的颜色画一个迷你窗口（侧栏 + 正文 + 按钮条）。
     *
     * 这里的颜色**故意不读宿主令牌** —— 预览要显示的是"点了会变成什么样"，
     * 读宿主令牌就变成"现在是什么样"，八张卡片会长得一模一样（用户 2026-10-03 就是照这个提的）。
     * 只有"不覆盖"那张没有自己的颜色，让它读 var()，如实画出当前界面。
     * 明暗档跟着当前生效的那一档走；读不到就按亮档，不猜。
     */
    function SkinSwatch({ tokens }) {
      const scheme = runtime.scheme === 'dark' ? 'dark' : 'light';
      const at = (token) => (tokens ? (tokens[token]?.[scheme] ?? 'transparent') : `var(${token}, transparent)`);
      const line = (w, color, cls) => h('span', { className: `ap-sw-line${cls ? ` ${cls}` : ''}`, style: { width: w, background: color } });
      return h('span', { className: 'ap-swatch', style: { background: at('--dsw-alias-bg-base'), borderColor: at('--dsw-alias-border-l1') } },
      h('span', { className: 'ap-sw-rail', style: { background: at('--dsw-alias-bg-layer-2') } },
        h('span', { className: 'ap-sw-dot', style: { background: at('--dsw-alias-brand-primary') } }),
        line('84%', at('--dsw-alias-menu-icon')),
        line('58%', at('--dsw-alias-menu-icon')),
        line('70%', at('--dsw-alias-menu-icon'))),
      h('span', { className: 'ap-sw-main', style: { background: at('--dsw-alias-bg-layer-1') } },
        line('44%', at('--dsw-alias-label-primary'), 'ap-sw-h'),
        line('88%', at('--dsw-alias-label-tertiary')),
        line('66%', at('--dsw-alias-label-tertiary')),
        h('span', { className: 'ap-sw-row' },
          h('span', { className: 'ap-sw-chip', style: { background: at('--dsw-alias-button-primary-fill') } }),
          h('span', { className: 'ap-sw-chip2', style: { background: at('--dsw-alias-bg-layer-3') } }))));
    }

    function AppearancePage() {
      /**
       * tick 只用来"重画"，**绝不挂到 key 上**。
       * 上一版是 `h('div', { className: 'ap-root', key: tick })` —— 每点一次就把整棵子树连 DOM 一起
       * 重挂一遍，而 `.ap-root` 正是滚动容器：于是"在配色区点一张皮肤"这个动作会把面板弹回顶部。
       * 这正是用户说的"页面交互不行"里最硬的一条，而且它在静态截图上完全看不出来。
       */
      const [, setTick] = useState(0);
      /** 正在处理的是哪一格（`'mark'` / `'name'` / null）。分开放是为了让"处理中…"只出现在那一格上。 */
      const [busy, setBusy] = useState(null);
      /** 上一次选文件的结果，带着它属于哪一格：`{text, target}`。 */
      const [pickError, setPickError] = useState(null);
      /**
       * 图片处理成什么样了（"已裁成方形 · 从 2.4MB 压到 86KB"）—— 就地显示，不弹提示条。
       * 但**不是"点过就一直挂着"**，见 noteFor。
       */
      const [pickNote, setPickNote] = useState(null);
      /** null = 用户还没敲过名称框，显示当前生效的那个名字；敲过就是草稿。 */
      const [nameDraft, setNameDraft] = useState(null);
      /** 名称行的坏消息（超长等）。成功了不吭声 —— 名字就在输入框里、侧栏也换了，那是落点。 */
      const [nameMsg, setNameMsg] = useState(null);
      const bump = () => setTick((t) => t + 1);

      /**
       * 那一格**现在画的**是不是"上一次处理出来的那张图"。判据在 `noteVisible` 里（纯函数，可离线断言），
       * 这里只负责把它落到界面文案上。
       */
      const noteFor = (target) => (noteVisible(pickNote, target) ? pickNote.text : null);
      /**
       * 那行红字说的是"刚才那次尝试"，所以它**留着**，直到被下一次尝试或同一区块里的动作取代
       * —— 尝试失败时那一格什么图都没换上，"跟着状态走"的判据在那儿等于永久隐形。
       */
      const errFor = (target) => (pickError && pickError.target === target ? pickError.text : null);

      /** 开始一次选图：先把自己那一格的旧结果清掉，免得旧绿字和新进度同时挂着。 */
      const beginUpload = (target) => {
        setBusy(target);
        setPickError(null);
        setPickNote(null);
      };

      /** 点一张配色：先让界面切过去（当场可见），再落宿主存档；存档回话后连错误一起重画。 */
      const chooseSkin = (id) => {
        runtime.userChose = true;
        applySkin(themeRef, id);
        bump();
        postReport();
        persistSkin(id).then(bump);
      };

      /** 点一枚标志：'off' 就是"用回官方图标"，setBrand 会去把占过的格撤掉、官方那条自己回到渲染位。 */
      const chooseMark = (key) => {
        runtime.userChose = true;
        runtime.markTouched = true;
        const next = key === 'off'
          ? { mode: BRAND_MODE_OFF }
          : { mode: BRAND_MODE_BUILTIN, markId: key };
        if (setBrand(next)) setPickError(null);
        else setPickError({ text: '这个标志没被接受，当前还是原来那个', target: LOGO_TARGET_MARK });
        bump();
        postReport();
        persistBrand().then(bump);
      };

      /** 名称行：把输入框里的字送进那一格；只在失败时出一行红字，成功不吭声。 */
      const applyName = () => {
        const text = nameDraft ?? (runtime.brand.name ?? '');
        const r = setBrandName(text);
        setNameMsg(r.ok ? null : { ok: false, text: r.reason });
        if (r.ok) {
          runtime.userChose = true;
          runtime.nameTouched = true;
          setNameDraft(null);
          persistBrand().then(bump);
          postReport();
        }
        bump();
      };

      /**
       * 换名称行的**来源**（下拉那一项）。三条路径的差别全在 `setBrandNameSource` 里，
       * 这里只管把"用户动过"的账记对：
       *   · `off`   —— 那一格整个还回去（文字与图片两头都清）。它同时动了 `name` 与 `nameImage`
       *               两个字段，所以**两个开关都要举起来**：只举一个的话 `persistBrand` 会以为
       *               "我们还不知道另一个的值"，把清空这件事漏掉 —— 重启后图就回来了。
       *   · `text`  —— 只改来源（`nameImage` 那一个字段），文字一个字节不碰。
       *   · `image` —— 同上。**只是把那一格切到"用图"这个来源，不主动弹文件框**：
       *               弹不弹由用户点不点「选图片」决定，选了来源不等于要立刻选文件
       *               （用户 2026-10-04 明确要求"点击选图片才弹"）。
       */
      const chooseNameSource = (next) => {
        if (!NAME_SRC_LIST.includes(next)) return;
        setBrandNameSource(next);
        setNameDraft(null);
        setNameMsg(null);
        setPickError(null);
        setPickNote(null);
        runtime.userChose = true;
        runtime.imageTouched = true;
        if (next === NAME_SRC_OFF) runtime.nameTouched = true;
        persistBrand().then(bump);
        postReport();
        bump();
      };

      /**
       * 只清掉名称行那张图：文字还在，所以清完那一格显示的是用户填的字（没有字就回到官方）。
       * 来源也跟着退回「自定义文字」/「官方字标」（`setBrandNameImage(null)` 里做）——
       * 否则下拉会停在「自定义图片」而那一格画的却是文字，自相矛盾。
       */
      const clearNameImage = () => {
        setBrandNameImage(null);
        setPickError(null);
        setPickNote(null);
        runtime.userChose = true;
        runtime.imageTouched = true;
        /**
         * 只写这一个字段（`{brand:{nameImage:false}}`）：文字与档位一个字节都不碰。
         * 宿主那边 `brand` 底下每个字段各自独立判存，所以这条最小 patch 是合法的 ——
         * 而"顺手把整条 brand 一起写上去"会把我们还没读到的那些值覆盖成空。
         */
        persist({ brand: { nameImage: false } }).then(bump);
        postReport();
        bump();
      };

      /** 两格图走同一条上传通道，只是落点不同；结果各带各的 target，界面上也就各归各位。 */
      const pickImage = (file, target) => {
        beginUpload(target);
        uploadImage(file, target, (err, note) => {
          setBusy(null);
          setPickError(err ? { text: err, target } : null);
          setPickNote(note ? { text: note, target } : null);
          bump();
        });
      };

      // 顺序 = 界面顺序：「不覆盖」排第一（用户 2026-10-04 要求）。它是进来默认选中的那一项
      // （默认档 = 原样），排在首位，用户一眼就能把"现在生效的"和"第一张卡"对上。
      const choices = [
        { id: SKIN_NONE_ID, name: '不覆盖', note: '去掉本插件的配色，回到内置外观', tokens: null, tokenCount: 0 },
        ...skinList().map((s) => ({ id: s.id, name: s.name, note: s.note, tokens: s.tokens, tokenCount: Object.keys(s.tokens || {}).length })),
      ];
      const skinIds = choices.map((c) => c.id);

      return h('div', { className: 'ap-root' },
      h(Head),
      h(SectionHead, { title: '标志', hint: '换的是侧栏与会话首屏那两格图标；名称行在下面单独设，两件事各管各的' }),
      h(LogoSection, {
        onPick: chooseMark,
        busy,
        markError: errFor(LOGO_TARGET_MARK),
        markNote: noteFor(LOGO_TARGET_MARK),
        nameDraft,
        nameMsg,
        onNameDraft: setNameDraft,
        onNameApply: applyName,
        onNameSource: chooseNameSource,
        onNameFile: (file) => pickImage(file, LOGO_TARGET_NAME),
        onNameClear: clearNameImage,
        nameImageNote: noteFor(LOGO_TARGET_NAME),
        nameImageError: errFor(LOGO_TARGET_NAME),
        onMarkFile: (file) => pickImage(file, LOGO_TARGET_MARK),
      }),
      h(SectionHead, { title: '配色', hint: '点一张就叠到内置配色上；不覆盖 = 本插件不动配色' }),
      // 整张卡就是一个单选项：点哪儿都算数，选中态长在卡自己身上（描边 + 角标），
      // 卡里不再嵌按钮 —— 一个选择只能有一个入口，两个就会出现"我点的到底是哪个"。
      h('div', { className: 'ap-cards', role: 'radiogroup', 'aria-label': '配色' },
      choices.map((c) => {
        const on = runtime.skinId === c.id;
        return h('button', {
          key: c.id, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
          className: `ap-skin${on ? ' ap-on' : ''}`, 'data-ap-id': c.id,
          disabled: !runtime.themeReady,
          onClick: () => chooseSkin(c.id),
          onKeyDown: (e) => radioKeys(e, skinIds, c.id, chooseSkin),
        },
        h('span', { className: 'ap-skin-h' },
          h('span', { className: 'ap-skin-name' }, c.name),
          on ? h('span', { className: 'ap-check' }, h(CheckMark)) : null),
        h('span', { className: 'ap-skin-note' }, c.note),
        h(SkinSwatch, { tokens: c.tokens }),
        h('span', { className: 'ap-skin-foot' }, c.tokenCount ? `改 ${c.tokenCount} 处配色` : '不改任何配色'));
      })),
      h(StatusCard),
      h(Disclosure));
    }

    /* ------------------------------------------------------------
     * 5) 样式（只画本插件自己的界面，一律读宿主令牌 —— 皮肤换了这里跟着换）
     * ------------------------------------------------------------ */
    const CSS = [
      // 面板自己滚：宿主主列 `.BynINW_centerCol` 是 `display:flex;overflow:hidden`（真机构建里的原文），
      // 内容一超高就被直接裁掉 —— 用户 2026-10-03 报的"滚不动"就是这个。
      // 口径抄官方入口页：`.fO69Vq_page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:auto}`
      // —— 同一个 main slot 挂进去的页面，它这么滚得动，我们照它写，不自创 100vh（顶带高度算不进去会把尾巴吃掉）。
      // box-sizing 必须写在根**自己**身上：`X *` 那种星号选择器盖不到 X 本身（宿主前端没有任何通配重置）。
      '.ap-root{box-sizing:border-box;width:100%;padding:18px 20px 28px;display:flex;flex-direction:column;gap:16px;max-width:1120px;height:100%;overflow-y:auto;overscroll-behavior:contain}',
      '.ap-root>*{flex:none}',

      // 页头：标题 + 一行摘要。摘要那行是操作的反馈落点（用户红线：不许浮层提示条）。
      '.ap-head{display:flex;flex-direction:column;gap:9px}',
      '.ap-title{margin:0;font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-status{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px}',
      '.ap-chip{display:inline-flex;align-items:baseline;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-chip b{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-notices{display:flex;flex-direction:column;gap:6px}',
      '.ap-notice{margin:0;padding:7px 10px;border-radius:8px;font-size:12px;line-height:1.45;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent)}',
      '.ap-err{color:var(--dsw-alias-state-error-primary,inherit)}',
      '.ap-ok{color:var(--dsw-alias-state-success-primary,inherit)}',
      '.ap-muted{color:var(--dsw-alias-label-tertiary,inherit)}',

      '.ap-sec{display:flex;flex-direction:column;gap:3px}',
      '.ap-sec-h{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-sec-note{margin:0;font-size:12px;line-height:1.5;max-width:78ch;color:var(--dsw-alias-label-tertiary,inherit)}',

      // ---- 标志：一排可点的方片（整片可点，卡里不再嵌按钮）----
      '.ap-marks{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;margin-top:2px}',
      // `display:contents`：这一层只是为了 role="radiogroup" 的语义（读屏软件要知道这七枚是一组），
      // 布局上让它透明 —— 否则方片会在这个盒子内部先换行，外面那格"选图片"就孤零零落到下一行。
      '.ap-mark-radios{display:contents}',
      '.ap-mark{appearance:none;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;padding:8px 4px 7px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-secondary,inherit)}',
      '.ap-mark-name{max-width:100%;font-size:11px;line-height:1.25;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ap-preview,.ap-thumb,.ap-mark-off{flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9px}',
      '.ap-mark-off{border:1px dashed var(--dsw-alias-border-l3,#8886);color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-thumb{border:1px dashed var(--dsw-alias-border-l2,#8886);background:var(--dsw-alias-bg-layer-2,transparent)}',
      '.ap-thumb-set{border-style:solid;border-color:var(--dsw-alias-border-l1,transparent)}',
      '.ap-thumb-plus{font-size:17px;line-height:1;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-mark-img{object-fit:contain;border-radius:6px}',
      '.ap-marks-note{flex:0 0 100%;margin:0;font-size:12px}',
      '.ap-marks-err{flex:0 0 100%;margin:0;font-size:12px}',
      '.ap-file{display:none}',

      // ---- 名称行：**一个下拉选来源**（官方字标 / 自定义文字 / 自定义图片）+ 该来源的那组操作 ----
      // 外面是 `flex-wrap`：窄面板放不下时**整组换行**（每组自己也是个 flex），不会把一组拆成两半。
      '.ap-name{flex:0 0 100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px}',
      '.ap-name-grp{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.ap-name-grp:empty{display:none}',
      '.ap-name-l{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
      // 下拉：`appearance:none` 拆掉系统那套外观，三角**自己画在外层 span 上**（select 没有伪元素），
      // 这样颜色能读宿主令牌 —— 用 data URI 画箭头就得写死一个色值，那条口子不开（红线）。
      '.ap-name-selwrap{position:relative;display:inline-flex;align-items:center}',
      '.ap-name-selwrap::after{content:"";position:absolute;right:9px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dsw-alias-label-tertiary,currentColor);pointer-events:none}',
      '.ap-name-sel{appearance:none;-webkit-appearance:none;font:inherit;font-size:12px;cursor:pointer;padding:5px 26px 5px 10px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-name-sel:hover:not([disabled]){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ap-name-sel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.ap-name-sel[disabled]{cursor:not-allowed;color:var(--dsw-alias-label-tertiary,inherit);background:transparent}',
      '.ap-name-i{width:200px;max-width:100%;box-sizing:border-box;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px}',
      '.ap-name-i::placeholder{color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-name-i:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      // 图片那一路是个 `<label>` 包着隐藏 input，所以它借用按钮的皮（`.ap-name-b`），
      // 但内部要能排一个缩略图 + 一句文字，所以补三条纵向对齐的规则。
      '.ap-name-b{appearance:none;font:inherit;font-size:12px;cursor:pointer;padding:5px 11px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-name-pick{display:inline-flex;align-items:center;gap:6px}',
      '.ap-name-thumb{flex:none;width:18px;height:18px;object-fit:contain;border-radius:4px}',
      // 禁用态**只退文字色、不退边框**：整块 opacity 降下去，按钮就淡成一串灰字，
      // 用户看不出"这里有两个按钮，只是现在还按不动"（第一版 .45 就是这样）。
      '.ap-name-b[disabled]{cursor:not-allowed;color:var(--dsw-alias-label-tertiary,inherit);background:transparent}',
      '.ap-name-msg{font-size:12px}',
      // 那句就地说明自己占一行（`flex:0 0 100%`），否则它会挤在控件后面把那一行撑爆。
      '.ap-name-hint{flex:0 0 100%;margin:0;font-size:12px}',
      // 名称行那一格画在**宿主侧栏上**（不在 `.ap-root` 里），所以这两条样式得自成一体：
      // 自己管溢出、自己读令牌取色，不靠外面任何上下文（长名字走 ellipsis，不许把侧栏撑开）。
      // 文字和图是那一格的两张脸，约束同一条：**不许把侧栏撑开**。
      '.ap-brandname{display:block;max-width:100%;font-size:14px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,inherit)}',
      // 图只封顶、不主动设尺寸：真机上那一格多宽多高由宿主给（§5-U12/U14 就是量这件事），
      // `object-fit:contain` 保证宽高比不乱。`max-height:2.2em` 是照着那行字标的高度收的。
      '.ap-brandimg{display:block;max-width:100%;max-height:2.2em;object-fit:contain}',

      // ---- 选中态：一个类名管两处（标志方片与配色卡，语汇一致）----
      '.ap-on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent)}',
      '.ap-mark:hover:not(.ap-on),.ap-skin:hover:not(.ap-on){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ap-name-b:hover:not([disabled]){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ap-mark:focus-visible,.ap-skin:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.ap-name-b:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

      // ---- 配色：整张卡就是一个单选项 ----
      '.ap-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));align-items:stretch;gap:12px;margin-top:2px}',
      '.ap-skin{appearance:none;font:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-skin[disabled]{opacity:.45;cursor:not-allowed}',
      '.ap-skin-h{display:flex;align-items:center;gap:8px}',
      '.ap-skin-name{flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ap-skin-note{margin:0;min-height:2.6em;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-tertiary,inherit)}',
      // 动作行钉在卡片底部：同一行卡片等高（grid stretch），脚注就必然齐平。
      '.ap-skin-foot{margin-top:auto;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-check{flex:none;display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}',

      // 皮肤预览块：颜色由 SkinSwatch 按那张皮肤自己给（见它上面的注释），这里只定形状。
      '.ap-swatch{display:flex;gap:6px;height:88px;padding:6px;border:1px solid;border-radius:9px;box-sizing:border-box;overflow:hidden}',
      '.ap-sw-rail{flex:none;display:flex;flex-direction:column;gap:5px;width:31%;padding:7px 6px;border-radius:6px;box-sizing:border-box}',
      '.ap-sw-main{flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0;padding:8px;border-radius:6px;box-sizing:border-box}',
      '.ap-sw-dot{flex:none;width:13px;height:13px;border-radius:4px}',
      '.ap-sw-line{flex:none;display:block;height:5px;border-radius:3px}',
      '.ap-sw-h{height:7px}',
      '.ap-sw-row{display:flex;align-items:center;gap:6px;margin-top:3px}',
      '.ap-sw-chip{flex:none;width:46px;height:13px;border-radius:7px}',
      '.ap-sw-chip2{flex:none;width:24px;height:13px;border-radius:7px}',

      // ---- 生效核对（只叠了配色层才出现）----
      '.ap-checks{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--dsw-alias-separator-primary,#8884)}',
      '.ap-checks-h{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
      '.ap-spots{display:flex;flex-wrap:wrap;gap:8px 22px}',
      '.ap-spot{display:flex;align-items:baseline;gap:8px;font-size:12px}',

      '.ap-disclosure{display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-separator-primary,#8884);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ap-disclosure p{margin:0}',
    ].join('\n');

    function injectStyle() {
      const el = globalThis.document?.createElement?.('style');
      if (!el) return () => {};
      el.textContent = CSS;
      globalThis.document.head?.appendChild?.(el);
      return () => { el.remove?.(); };
    }

    /* ------------------------------------------------------------
     * 6) apply
     * ------------------------------------------------------------ */
    let themeRef = null;

    function apply(ctx) {
      // 宿主没给路由前缀（多半是没 webServer）就一个入口都不注册：点开空白页比看不到入口更糟。
      if (!cfg().routePrefix) return;

      slotsRef = ctx.slots;

      ctx.effect(() => injectStyle(), 'appearance:style');
      // 卸载时把占过的 brand 格全撤掉：disposer 留在模块里，effect 树之外没人记得住。
      ctx.effect(() => () => clearBrand(), 'appearance:teardown');

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 90,
          label: () => cfg().label || '桌面外观',
        },
        PanelIcon,
      ));

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, AppearancePage));

      // 两格图标位 + 名称行：这里只登记"宿主声明过这格"，注册本身交给 syncBrand
      // （默认 off 且名称为空 = 一格都不占；两者各自独立判断）。
      for (const slot of [...BRAND_MARK_SLOTS, BRAND_NAME_SLOT]) {
        ctx.slots.inject(slot, () => {
          runtime.brandDeclared.add(slot);
          syncBrand();
        });
      }

      ctx.inject(['theme'], (c) => {
        themeRef = c.theme;
        runtime.themeReady = !!themeRef;
        // 先按"原样"落一次（不套层、不占格），再问宿主存档里有没有选择；有才覆盖。
        applySkin(themeRef, bootSkinId());
        bootBrand();
        loadPrefs();
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    exports.PANEL_ID = PANEL_ID;
    exports.AppearancePage = AppearancePage;
    exports.PanelIcon = PanelIcon;
    /** 测试出口：页面代码本身也从这里取，杜绝"测的是一份、跑的是另一份"。 */
    exports.__test = {
      GLOBAL_KEY, SKIN_SOURCE, SKIN_NONE_ID, BRAND_PRIORITY, BRAND_MODES, BRAND_MARK_SLOTS, BRAND_NAME_SLOT, SPOT_TOKENS,
      LOGO_ALLOWED_MIMES, LOGO_MIME_LABELS, LOGO_MAX_BYTES, LOGO_MAX_SOURCE_BYTES, LOGO_TARGET_PX, LOGO_QUALITY_STEPS, BRAND_NAME_MAX,
      LOGO_TARGETS, LOGO_TARGET_MARK, LOGO_TARGET_NAME, SHAPE_OF, NAME_LOGO_MAX_W, NAME_LOGO_MAX_H,
      NAME_SRC_LIST, NAME_SRC_LABELS, NAME_SRC_OFF, NAME_SRC_TEXT, NAME_SRC_IMAGE,
      cfg, skinById, applySkin, spotCheck, snapshotOf, postReport, runtime, CSS, injectStyle,
      BrandMark, NameSlot, nameArt, noteVisible, markShapes, setBrand, setBrandName, setBrandNameImage, clearNameArt,
      setBrandNameSource,
      syncBrand, desiredBrandSlots, clearBrand, bootBrand, loadPrefs, persist, persistSkin, persistBrand,
      uploadImage, shrinkImage, coverRect, hasAlpha, encodeUnderLimit, StatusCard, LogoSection, Disclosure, storeNote, brandSummary,
      Head, CheckMark, OffMark, radioKeys, skinLabel, brandLabel, nameBit, AppearancePage,
    };
    return module.exports;
  },
});
