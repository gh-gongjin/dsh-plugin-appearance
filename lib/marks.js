/**
 * lib/marks.js —— 内置标志款式的清单（只有数据，SVG 画在 client.js）
 *
 * 为什么单独一个文件、还放宿主半边能 import 的地方：宿主半边要把用户选的 markId
 * 存进 storageDomain，存之前得知道哪些 id 存在 —— 清单散在浏览器那半边，
 * 宿主就只能"存下任何字符串"，那等于把拼错的 id 存进库、下次启动画不出东西。
 *
 * `off` 是"用回原样"这一档：一格都不注册，官方品牌包自己就回来了。
 */

export const BRAND_MODE_OFF = 'off';
export const BRAND_MODE_BUILTIN = 'builtin';
export const BRAND_MODE_IMAGE = 'image';
export const BRAND_MODES = [BRAND_MODE_OFF, BRAND_MODE_BUILTIN, BRAND_MODE_IMAGE];

/** 只有这一档不需要任何用户数据。 */
export const BRAND_DEFAULT_MODE = BRAND_MODE_OFF;

/**
 * 名称行（`sidebar.brand.name` 那格字标）能存多少字。
 * 跨边界常量：宿主写入前校验、浏览器输入框限长、界面提示三处必须是同一个数（ap-20 咬）。
 * 卡 24 是因为那一格旁边还有系统自己的东西（窗口控制、折叠按钮），再长必然被宿主裁掉
 * —— 与其让用户以为自己存了 40 字、真机只显示 12 字，不如在输入框那一步就说清上限。
 */
export const BRAND_NAME_MAX = 24;

/**
 * 六款自绘标志。id 是存进库的值，改名不改 id。
 * 每款都只用两个颜色：`brand-primary` 当图形色、`label-primary-inverted` 当留白，
 * 这一对正是 sk-10 卡了 4.5:1 的那一对 —— 皮肤换了，标志跟着换色且始终读得清。
 */
export const BRAND_MARKS = [
  { id: 'letter', name: '方块 A', note: '圆角方块里一个 A' },
  { id: 'ring', name: '圆环', note: '空心圆 + 中心点' },
  { id: 'diamond', name: '方解', note: '菱形套菱形' },
  { id: 'hex', name: '六出', note: '六角形留个圆心' },
  { id: 'drop', name: '水滴', note: '上尖下圆' },
  { id: 'spark', name: '星芒', note: '四角星，实心' },
];

export function markById(id) {
  return BRAND_MARKS.find((m) => m.id === id) ?? null;
}
