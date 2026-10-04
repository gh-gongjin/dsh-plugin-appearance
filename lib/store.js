/**
 * lib/store.js —— 选择存档（宿主 `ctx.storageDomain`）
 *
 * 存的东西只有三样：用户挑的皮肤、挑的标志、以及两格里各自挑的图片。都是"要被覆盖"的语义，
 * 所以两张表都允许同 key 覆盖写：`prefs` 固定一行 `current`（一台机器一份选择），
 * `logo` **两行** —— `current` 是两格图标位那张、`name` 是名称行那张（见下面 ROW_KEY_NAME）。
 *
 * ## 为什么 schema 里不写死枚举
 *
 * `skinId` 存的是普通字符串，**已知 id 的校验落在写入这一侧**（`writePrefs`）。
 * 反过来的做法（把 id 枚举写进 schema）会在皮肤改名或删除后炸出 `invalid-record`，
 * 让整份存档读不出来 —— 那是数据的错，不是用户的错。现在旧 id 照样读得回来，
 * 由界面如实显示「未知皮肤（id）」并回落到原样，不猜。
 *
 * ## 四个生命周期坑（与 dsh-plugin-stock-analysis/lib/kv-store.js 同源，逐条实现）
 *
 * 1. **取设施可能抛**：Cordis 的 Context 是代理，读未 inject 的服务会抛
 *    `cannot get property "storageDomain" without inject`；所以调用方给的是**取值函数**，
 *    取不到就当"暂时没有"，由 `available` 如实报出。
 * 2. **打开失败不许缓存那个坏 promise**：否则一次命名冲突之后这功能在本进程里永久报废。
 * 3. **写队列串行，且前一笔失败不能卡死后面**：KV 没有事务，串起来是唯一能买到
 *    "谁最后写"确定性的办法；被 rejected 卡住 = 后续所有写静默不执行，比失败更糟。
 * 4. **close 必须 await 打开中的 promise 再关**：domain 名要调用方自己释放，
 *    不释放的话插件重载时 `open()` 直接撞 `already-open`。
 */

import {
  defineDomain, domainTable, record, requiredString, optionalString, optionalInt,
} from './schema.js';
import { SKINS, SKIN_NONE_ID } from './skins.js';
import { BRAND_MODES, BRAND_MODE_BUILTIN, BRAND_MARKS, BRAND_NAME_MAX } from './marks.js';

export const DOMAIN_NAME = 'appearance_prefs';
export const SCHEMA_VER = 1;
/** 行 key：一台机器一份选择。 */
export const ROW_KEY = 'current';
/**
 * 图片存档的**两格**：`logo` 表按行 key 区分用途 —— `current` 是两格图标位那张，
 * `name` 是名称行那张（第六轮加，用户要那格也能换图）。
 *
 * 为什么走"同一张表加一行"而不是"加一张表"或"加字段"：
 *   · 加表要动 domain 的 tables 清单 —— 宿主的 layout 是**按清单铺的**，旧档里没有这一格，
 *     能不能补上我离线验不了（§5 那类"只有真机知道"的坑），不能拿用户的存档去赌；
 *   · 加字段（一个 blob 劈成两半）会把 `mime`/`data` 从必填改成选填，还要加一条跨字段规则 ——
 *     改必填就是改语义，而"名称行有图、图标位没图"正好会撞上它（旧档读不出来 = 数据的错让用户背）；
 *   · 加一行只用到 KV 表本来就支持的任意 key 语义：`current` 一个字节不动，旧档照读，
 *     `name` 缺席就是"没选过名称行的图"（null），与"选了又清掉"在界面上是同一件事（都还原官方）。
 */
export const ROW_KEY_NAME = 'name';
/** 图片的两个去处。顺序即语义：`mark` = 两格图标位，`name` = 名称行。 */
export const LOGO_TARGETS = ['mark', 'name'];
const ROW_KEY_OF = { mark: ROW_KEY, name: ROW_KEY_NAME };

/** 标志图片的硬上限（与浏览器半边那个提示同一个数，改要一起改）。 */
export const LOGO_MAX_BYTES = 200 * 1024;
/** base64 比原字节长约 4/3，留足余量；超限在 schema 层就报错，不截断。 */
const LOGO_MAX_B64_CHARS = 320_000;
/** 只收这四种：宿主界面里只会出现在 `<img src>`，其余类型一律当"不是图片"拒掉。 */
export const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export const STORE_ERROR = {
  CLOSED: 'STORE_CLOSED',
  UNAVAILABLE: 'STORE_UNAVAILABLE',
  BAD_SKIN: 'UNKNOWN_SKIN',
  BAD_BRAND: 'UNKNOWN_BRAND',
  BAD_LOGO: 'BAD_LOGO',
};

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const prefsRecord = record({
  skinId: optionalString('prefs.skinId', { maxLength: 40 }),
  brandMode: optionalString('prefs.brandMode', { maxLength: 16 }),
  brandMarkId: optionalString('prefs.brandMarkId', { maxLength: 40 }),
  /** 用户给名称行换的文字。**缺省 ≠ 空字符串**：缺省表示那一格没有文字。 */
  brandName: optionalString('prefs.brandName', { maxLength: BRAND_NAME_MAX }),
  /**
   * 名称行那一格**用不用图片**（1 = 用，缺省 = 不用）。
   *
   * 为什么"用不用"要单独存一个标记，而不是"logo 表里有没有 `name` 那一行"：
   * 用户点「清掉图片」之后那张图必须**真的不算数**（包括重启后），而抹掉它只有两条路 ——
   * 删掉那一行，或把这一格标记成不用。宿主的表句柄有没有 `delete` 我离线验不了
   * （桩里有，但桩是照文档写的，不能拿它当真机证据），而 `put` 是已经在用的能力。
   * 所以走标记：**代价是那张图的字节留在库里不主动回收**（最多 200KB，下一次换图原地覆盖），
   * 换来的是"清掉"这件事只依赖一条已经被真机验证过的通道。
   */
  brandNameImage: optionalInt('prefs.brandNameImage'),
  updatedAt: optionalInt('prefs.updatedAt'),
}, 'prefs');

const logoRecord = record({
  mime: requiredString('logo.mime', { maxLength: 64 }),
  /** base64（不含 `data:` 前缀）。前缀由浏览器半边带来，写入前剥掉。 */
  data: requiredString('logo.data', { maxLength: LOGO_MAX_B64_CHARS }),
  updatedAt: optionalInt('logo.updatedAt'),
}, 'logo');

export const prefsDomain = defineDomain({
  name: DOMAIN_NAME,
  version: SCHEMA_VER,
  tables: {
    prefs: domainTable(prefsRecord),
    logo: domainTable(logoRecord),
  },
});

/** 已知皮肤 id（含"不覆盖"那一项）。 */
export const KNOWN_SKIN_IDS = [SKIN_NONE_ID, ...SKINS.map((s) => s.id)];
const KNOWN_MARK_IDS = BRAND_MARKS.map((m) => m.id);

/**
 * @param {object} options
 * @param {() => object|undefined} options.getFacility 惰性取 `ctx.storageDomain`（见坑 1）
 * @param {() => number} [options.now] 注入时钟，测试用
 */
export function createAppearanceStore({ getFacility, now = () => Date.now() } = {}) {
  let opening = null;
  let closed = false;
  /** 最近一次打开失败的原因，界面要读它（"存不住"必须说得出为什么）。 */
  let lastError = null;

  const facilityOf = () => {
    try {
      return typeof getFacility === 'function' ? getFacility() : undefined;
    } catch {
      return undefined;
    }
  };

  const hasFacility = () => {
    const f = facilityOf();
    return Boolean(f && typeof f.open === 'function');
  };

  function ensureDomain() {
    if (closed) throw new StoreError(STORE_ERROR.CLOSED, '存档仓储已关闭');
    if (!hasFacility()) {
      throw new StoreError(STORE_ERROR.UNAVAILABLE, '宿主没给存储通道，这台机器上存不住 —— 重启后回到原样');
    }
    if (!opening) {
      opening = facilityOf()
        .open(prefsDomain)
        .catch((error) => {
          opening = null; // 坑 2
          lastError = String(error?.message ?? error);
          throw error;
        });
    }
    return opening;
  }

  let chain = Promise.resolve();
  const enqueue = (job) => {
    const run = chain.then(() => job());
    chain = run.then(() => undefined, () => undefined); // 坑 3
    return run;
  };

  const tableOf = async (name) => (await ensureDomain()).table(name);

  const rowOf = (row) => (row === undefined ? null : row);

  return {
    get available() {
      return hasFacility() && !closed;
    },
    get lastError() {
      return lastError;
    },

    /** 坑 4：必须 await 打开中的 promise 再关，否则 domain 名没释放。 */
    async close() {
      closed = true;
      const pending = opening;
      opening = null;
      if (!pending) return;
      try {
        await (await pending).close();
      } catch {
        /* 没打开成功过，没什么可关 */
      }
    },

    /**
     * 读存档。`{ prefs: null, logo: null, nameLogo: null }` 表示**从未写入**
     * （与"写成了空"是两件事）。两张图各自缺席即各自为 null。
     * 读不出来的两种原因（没通道 / open 失败）原样抛给调用方，由界面说人话。
     */
    readAll() {
      return enqueue(async () => {
        const p = await tableOf('prefs');
        const l = await tableOf('logo');
        return {
          prefs: rowOf(p.get(ROW_KEY)),
          logo: rowOf(l.get(ROW_KEY)),
          nameLogo: rowOf(l.get(ROW_KEY_NAME)),
        };
      });
    },

    /**
     * 写选择。整份覆盖，未声明字段被 record 丢掉。
     * 已知 id 的校验在这里：未知皮肤 / 未知标志档位**存不进去**（不是存进去再在界面上出错）。
     * @param {{skinId?: string, brand?: {mode: string, markId?: string|null}}} patch
     */
    writePrefs(patch = {}) {
      return enqueue(async () => {
        const current = rowOf((await tableOf('prefs')).get(ROW_KEY)) ?? {};
        const next = { ...current };
        if (patch.skinId !== undefined) {
          if (!KNOWN_SKIN_IDS.includes(patch.skinId)) {
            throw new StoreError(STORE_ERROR.BAD_SKIN, `没有这张皮肤：${String(patch.skinId).slice(0, 40)}`);
          }
          next.skinId = patch.skinId;
        }
        if (patch.brand !== undefined) {
          /**
           * `brand` 底下**每个字段各自独立判存**（`Object.hasOwn`）。三处都是同一条理由：
           * 调用方常常只想动其中一样（只填名字、只选图、只换图标），而这里是**整份覆盖写** ——
           * 谁"没带"某个字段，谁就是在说"我不知道它现在是什么，别动它"。
           * 所以 `mode` 也必须有这条判断：只写 {nameImage:true} 的一条 patch 不该要求调用方
           * 先查出当前档位再把它一起送上来（那等于逼调用方去读一次它并不关心的状态）。
           */
          if (Object.hasOwn(patch.brand, 'mode')) {
            const mode = patch.brand?.mode;
            if (!BRAND_MODES.includes(mode)) {
              throw new StoreError(STORE_ERROR.BAD_BRAND, `标志档位只认 ${BRAND_MODES.join(' / ')}，收到 ${String(mode).slice(0, 16)}`);
            }
            const markId = patch.brand?.markId ?? null;
            // 内置那档必须点名到一枚已知标志；图片档不带 markId（图片本身在 logo 表里）。
            if (mode === BRAND_MODE_BUILTIN && !KNOWN_MARK_IDS.includes(markId)) {
              throw new StoreError(STORE_ERROR.BAD_BRAND, `内置标志里没有这一枚：${String(markId).slice(0, 40)}`);
            }
            next.brandMode = mode;
            next.brandMarkId = mode === BRAND_MODE_BUILTIN ? markId : undefined;
          }
          /**
           * 名称行那张图的文字：`null` / `''` / 全空白统一归一成 undefined ⇒ 那一格没有文字。
           * 只填名字不换图标（mode 仍是 off）是合法组合，所以它自带存在性判断。
           */
          if (Object.hasOwn(patch.brand, 'name')) {
            const raw = patch.brand.name;
            if (raw !== null && raw !== undefined && typeof raw !== 'string') {
              throw new StoreError(STORE_ERROR.BAD_BRAND, '名称行只能是文字');
            }
            const name = typeof raw === 'string' ? raw.trim() : '';
            if (name.length > BRAND_NAME_MAX) {
              throw new StoreError(STORE_ERROR.BAD_BRAND, `名称行太长（${name.length} 字，上限 ${BRAND_NAME_MAX} 字）`);
            }
            next.brandName = name === '' ? undefined : name;
          }
          /**
           * 名称行那张图算不算数。跟文字一样**自带存在性判断**（`Object.hasOwn`）：
           * 只换图标的一条 patch 不该顺手把"用不用图"重置掉。
           * `false` / `null` 都归一成 undefined（那一格不再用图）；缺省字段 = 不动。
           */
          if (Object.hasOwn(patch.brand, 'nameImage')) {
            const raw = patch.brand.nameImage;
            if (raw !== null && raw !== undefined && typeof raw !== 'boolean') {
              throw new StoreError(STORE_ERROR.BAD_BRAND, '名称行用不用图片只能是 true / false');
            }
            next.brandNameImage = raw === true ? 1 : undefined;
          }
        }
        next.updatedAt = now();
        const parsed = prefsDomain.tables.prefs.valueSchema.parse(next);
        await (await tableOf('prefs')).put(ROW_KEY, parsed);
        return parsed;
      });
    },

    /**
     * 写标志图片。类型与大小在这道门口重新验一遍 —— 浏览器那边验过不算数，
     * 这条路由谁都能调，落库的却是宿主自己的目录。
     *
     * **两个去处共用这一道门**：`which` 只决定写进哪一行，四个验点（白名单 / 非空 /
     * 解得开 / ≤200KB）一个字不差。名称行那张图放行得更宽是不允许的 ——
     * 它就是同一个 `/api/logo` 路由的另一半，闸松了等于整条路松了。
     *
     * @param {{mime: string, data: string, which?: 'mark'|'name'}} input data 为纯 base64
     */
    writeLogo(input = {}) {
      return enqueue(async () => {
        const which = input.which ?? 'mark';
        if (!LOGO_TARGETS.includes(which)) {
          throw new StoreError(STORE_ERROR.BAD_LOGO, `图片只有 ${LOGO_TARGETS.join(' / ')} 两个去处，收到 ${String(which).slice(0, 16)}`);
        }
        const mime = String(input.mime ?? '');
        if (!LOGO_MIMES.includes(mime)) {
          throw new StoreError(STORE_ERROR.BAD_LOGO, `只收 ${LOGO_MIMES.join(' / ')}，收到 ${mime.slice(0, 40) || '（空）'}`);
        }
        const data = String(input.data ?? '');
        if (!data) throw new StoreError(STORE_ERROR.BAD_LOGO, '图片正文是空的');
        let bytes;
        try {
          bytes = Buffer.from(data, 'base64');
        } catch {
          throw new StoreError(STORE_ERROR.BAD_LOGO, '图片没解出内容');
        }
        if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) {
          throw new StoreError(STORE_ERROR.BAD_LOGO, `图片 ${bytes.length} 字节，上限 ${LOGO_MAX_BYTES} 字节（空文件与超限都拒）`);
        }
        const parsed = prefsDomain.tables.logo.valueSchema.parse({ mime, data, updatedAt: now() });
        await (await tableOf('logo')).put(ROW_KEY_OF[which], parsed);
        return { which, mime: parsed.mime, updatedAt: parsed.updatedAt, bytes: parsed.data.length };
      });
    },

    /**
     * 读某一格的图片正文；从未写过返回 null。
     * 两张图各有各的 `updatedAt`，所以界面上的 URL 版本号也是各管各的 ——
     * 换名称行那张不会让图标位那张白白重取一遍。
     */
    readLogo(which = 'mark') {
      return enqueue(async () => rowOf((await tableOf('logo')).get(ROW_KEY_OF[which] ?? ROW_KEY)));
    },
  };
}
