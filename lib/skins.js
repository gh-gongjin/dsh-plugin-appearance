/**
 * lib/skins.js —— 皮肤定义表（一份真相：宿主半边与浏览器半边都从这里出）
 *
 * 每个令牌必须同时给 light 与 dark 两个值。这不是啰嗦：宿主 `ctx.theme.overrideTokens`
 * 在运行时校验这一点，只给一档会当场抛错（`ThemeTokenOverrides` 的契约），
 * 防的是"用户在内置外观行切了 light/dark 之后文字糊在底色上"。
 *
 * 令牌名不是凭印象写的：全部取自真机在跑的那份构建
 * （`D:\Deepseek harness desktop\resources\app.asar`，0.2.0-rc.2）里抽出的 120 个
 * `--dsw-alias-*`，清单存 `test/fixtures/host-tokens.txt`，由 test/skins.test.mjs 逐个核对。
 * 宿主升级后那份清单要重采 —— 0.1.7 是 99 个、0.2.0 已经是 120 个，这份表不能假设它不变。
 *
 * 只覆盖 24 个是刻意的：其余 93 个如实露出内置配色。"整套皮肤"要逐个填满才算数，
 * 现在填不满就说填不满，不假装覆盖完了。
 *
 * 八张皮肤盖的是**同一批** 24 个槽位（sk-4 钉这条）：换肤时不许露出上一张没盖的格子，
 * 否则从暗档皮肤切到亮档皮肤会有一批令牌停在内置值上，看着像"切了一半"。
 *
 * 暗档的强调底（brand-primary / button-primary-fill）一律取**亮色**、而 `label-primary-inverted`
 * 取深墨：反白文字要落在强调底与品牌徽标上，暗档再给深底就没人能读（sk-10 就是钉这一条的闸，
 * 第一版给的是 #2F5FAE 深靛，量出来 2.96:1 当场红）。
 *
 * ⚠️ **令牌名会骗人：必须按「用途」填，不许按名字猜前景还是背景。**
 * 名字里带 `label` 的是字色、带 `bg`/`fill` 的是底 —— 但 `--dsw-alias-markdown-inline-code`
 * 是个反例：它读起来像"行内代码的字色"，实际宿主只拿它做 `background-color`（行内代码的**底色**）。
 * 第一版按名字猜、当字色填了深藏蓝/近白 ⇒ 亮档"深底 + 深字"、暗档"浅底 + 浅字"，
 * 换肤后整块行内代码看不见（用户 2026-10-05 截图报的真机 bug）。
 * 判定用途的办法不是读名字，是去 **运行中的 asar 里看它被哪个 CSS 属性用了** ——
 * `node tmp/token-audit.mjs` 就是干这个的（只扫两遍建索引，逐令牌扫会被 121MB 文本拖死）。
 * 取证原文：`.markdown code{background-color:var(--dsw-alias-markdown-inline-code);
 * border:0.5px solid var(--dsw-alias-border-l1)}`，宿主默认指 `--dsw-static-neutral-50`(#FAFAFA)
 * / `--dsw-static-neutral-800`(#292929) —— 即"极微妙的中性灰 + 细描边"，不是高对比色块。
 *
 * 所以这个令牌现在的口径是：**从 `bg-base` 推导的、低饱和的柔和表面**（取底色的 HSL，
 * 饱和降到 ≤30%、亮档 L−7 / 暗档 L+6），逐条皮肤与自家色相贴齐，而不是塞一个抢眼的强调色。
 * 推导脚本留档 `tmp/inline-code-fix.mjs`；sk-12 钉"它是底"（对正文色的对比要够、且不许等于正文色本身）。
 */

/** override 层的身份键；宿主按这个键替换整层，重复调用是"换一层"而不是"叠一层"。 */
export const SKIN_SOURCE = 'dsh-plugin-appearance';

/** 不覆盖任何令牌（回到内置配色）在选择器里的 id。 */
export const SKIN_NONE_ID = 'none';

/**
 * 首次加载时套哪张。**定为"不覆盖"**：用户 2026-10-03 要求「进来默认还是原样」——
 * 插件不该一装配就把人家的界面改了，得用户点过才动。
 * 接了持久化之后，这里有存档的话以存档为准（lib/store.js 读出来交给 boot 载荷）。
 */
export const DEFAULT_SKIN_ID = SKIN_NONE_ID;

export const SKINS = [
  {
    id: 'ink',
    name: '墨蓝',
    note: '冷调：底偏蓝、强调色收深一档',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F1F5FC', dark: '#0D1420' },
      '--dsw-alias-bg-layer-1': { light: '#FAFCFF', dark: '#121B2A' },
      '--dsw-alias-bg-layer-2': { light: '#EEF3FB', dark: '#182337' },
      '--dsw-alias-bg-layer-3': { light: '#E3EBF7', dark: '#20304A' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#162032' },
      '--dsw-alias-settings-card-fill': { light: '#F7FAFE', dark: '#141E2E' },
      '--dsw-alias-label-primary': { light: '#101A2B', dark: '#E8EEF8' },
      '--dsw-alias-label-primary-dimmed': { light: '#33445C', dark: '#C2CDDE' },
      '--dsw-alias-label-secondary': { light: '#4A5B74', dark: '#A6B4C8' },
      '--dsw-alias-label-tertiary': { light: '#6B7C95', dark: '#8494AC' },
      '--dsw-alias-label-primary-inverted': { light: '#F5F8FF', dark: '#0D1420' },
      '--dsw-alias-link': { light: '#1F5FD0', dark: '#8FB4FF' },
      '--dsw-alias-border-l1': { light: '#D5DFEE', dark: '#243149' },
      '--dsw-alias-border-l2': { light: '#C2D0E4', dark: '#2E3E5A' },
      '--dsw-alias-separator-primary': { light: '#DCE5F2', dark: '#22304A' },
      '--dsw-alias-brand-primary': { light: '#1E4FA8', dark: '#9CC0FF' },
      '--dsw-alias-brand-text': { light: '#16386F', dark: '#BFD5F7' },
      '--dsw-alias-state-business-primary': { light: '#2A5FC0', dark: '#9CC0FF' },
      '--dsw-alias-button-primary-fill': { light: '#1E4FA8', dark: '#9CC0FF' },
      '--dsw-alias-button-primary-hover': { light: '#18407F', dark: '#B4D2FF' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#CBD8EA', dark: '#2A3A55' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#A9BCD8', dark: '#3D5476' },
      '--dsw-alias-markdown-inline-code': { light: '#DDE2ED', dark: '#1A2331' },
      '--dsw-alias-menu-icon': { light: '#3A4C66', dark: '#A6B4C8' },
    },
  },
  {
    id: 'moss',
    name: '苔绿',
    note: '暖调：纸感底、强调色偏苔',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F3F5EE', dark: '#101711' },
      '--dsw-alias-bg-layer-1': { light: '#FBFCF7', dark: '#161F18' },
      '--dsw-alias-bg-layer-2': { light: '#EEF1E6', dark: '#1D281F' },
      '--dsw-alias-bg-layer-3': { light: '#E1E6D5', dark: '#26332A' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFC', dark: '#1A241C' },
      '--dsw-alias-settings-card-fill': { light: '#F7F9F1', dark: '#18211A' },
      '--dsw-alias-label-primary': { light: '#16211A', dark: '#E7EDE4' },
      '--dsw-alias-label-primary-dimmed': { light: '#3B4C3F', dark: '#BFCBC0' },
      '--dsw-alias-label-secondary': { light: '#54665A', dark: '#A3B2A6' },
      '--dsw-alias-label-tertiary': { light: '#74857A', dark: '#82957F' },
      '--dsw-alias-label-primary-inverted': { light: '#F6F8F2', dark: '#101711' },
      '--dsw-alias-link': { light: '#2C6B45', dark: '#8FD0A6' },
      '--dsw-alias-border-l1': { light: '#D8DFCE', dark: '#28382B' },
      '--dsw-alias-border-l2': { light: '#C6CFB8', dark: '#35473A' },
      '--dsw-alias-separator-primary': { light: '#DFE5D6', dark: '#27352A' },
      '--dsw-alias-brand-primary': { light: '#2F6B45', dark: '#86D3A2' },
      '--dsw-alias-brand-text': { light: '#234A32', dark: '#C4DEC9' },
      '--dsw-alias-state-business-primary': { light: '#2F6B45', dark: '#86D3A2' },
      '--dsw-alias-button-primary-fill': { light: '#2F6B45', dark: '#86D3A2' },
      '--dsw-alias-button-primary-hover': { light: '#245235', dark: '#A6E2BB' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#CBD4BE', dark: '#2E4032' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#AEBBA0', dark: '#43584A' },
      '--dsw-alias-markdown-inline-code': { light: '#E3E8D8', dark: '#1D291E' },
      '--dsw-alias-menu-icon': { light: '#43544A', dark: '#A3B2A6' },
    },
  },
  {
    id: 'slate',
    name: '石墨',
    note: '中性灰阶：不带色偏，层次只靠明度分',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F4F4F5', dark: '#131315' },
      '--dsw-alias-bg-layer-1': { light: '#FAFAFB', dark: '#191A1D' },
      '--dsw-alias-bg-layer-2': { light: '#EDEDEF', dark: '#202125' },
      '--dsw-alias-bg-layer-3': { light: '#E0E0E3', dark: '#2A2B30' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#1C1D21' },
      '--dsw-alias-settings-card-fill': { light: '#F7F7F8', dark: '#17181B' },
      '--dsw-alias-label-primary': { light: '#17181A', dark: '#F0F0F2' },
      '--dsw-alias-label-primary-dimmed': { light: '#3A3C40', dark: '#C9CACC' },
      '--dsw-alias-label-secondary': { light: '#55575C', dark: '#A8AAAF' },
      '--dsw-alias-label-tertiary': { light: '#77797E', dark: '#86888D' },
      '--dsw-alias-label-primary-inverted': { light: '#FAFAFB', dark: '#131315' },
      '--dsw-alias-link': { light: '#2D5BD0', dark: '#B9BCC4' },
      '--dsw-alias-border-l1': { light: '#D5D5D8', dark: '#33343A' },
      '--dsw-alias-border-l2': { light: '#C0C0C5', dark: '#46484F' },
      '--dsw-alias-separator-primary': { light: '#DEDEE1', dark: '#2B2C31' },
      '--dsw-alias-brand-primary': { light: '#35383F', dark: '#D6D8DE' },
      '--dsw-alias-brand-text': { light: '#23252A', dark: '#E3E4E8' },
      '--dsw-alias-state-business-primary': { light: '#3C4148', dark: '#C6C9D0' },
      '--dsw-alias-button-primary-fill': { light: '#2A2C31', dark: '#D6D8DE' },
      '--dsw-alias-button-primary-hover': { light: '#1B1D21', dark: '#E7E9EE' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#C9CACC', dark: '#3A3B42' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#A9ABAF', dark: '#4E5058' },
      '--dsw-alias-markdown-inline-code': { light: '#E1E1E4', dark: '#222225' },
      '--dsw-alias-menu-icon': { light: '#4E5157', dark: '#A8AAAF' },
    },
  },
  {
    id: 'parchment',
    name: '羊皮纸',
    note: '暖米底 + 棕强调：长时间盯屏不刺眼',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F6F1E5', dark: '#1A1610' },
      '--dsw-alias-bg-layer-1': { light: '#FCF8EF', dark: '#211C15' },
      '--dsw-alias-bg-layer-2': { light: '#F0E9DA', dark: '#2A231A' },
      '--dsw-alias-bg-layer-3': { light: '#E5DBC6', dark: '#352C21' },
      '--dsw-alias-bg-overlay': { light: '#FFFDF7', dark: '#241F17' },
      '--dsw-alias-settings-card-fill': { light: '#F8F3E8', dark: '#1E1A13' },
      '--dsw-alias-label-primary': { light: '#241C12', dark: '#F0E7D6' },
      '--dsw-alias-label-primary-dimmed': { light: '#4A3D2C', dark: '#D6CAB4' },
      '--dsw-alias-label-secondary': { light: '#5E4F3A', dark: '#B7AA93' },
      '--dsw-alias-label-tertiary': { light: '#7E6E56', dark: '#8E8168' },
      '--dsw-alias-label-primary-inverted': { light: '#FBF6EA', dark: '#1A1610' },
      '--dsw-alias-link': { light: '#8A4A1F', dark: '#E0B978' },
      '--dsw-alias-border-l1': { light: '#E0D5BE', dark: '#3A3024' },
      '--dsw-alias-border-l2': { light: '#CFC2A6', dark: '#4C4030' },
      '--dsw-alias-separator-primary': { light: '#E7DECB', dark: '#33291D' },
      '--dsw-alias-brand-primary': { light: '#7A4A22', dark: '#E3B873' },
      '--dsw-alias-brand-text': { light: '#5C3517', dark: '#EBD3A6' },
      '--dsw-alias-state-business-primary': { light: '#8A5A2B', dark: '#D9AE6A' },
      '--dsw-alias-button-primary-fill': { light: '#7A4A22', dark: '#E3B873' },
      '--dsw-alias-button-primary-hover': { light: '#63391A', dark: '#EFCB8C' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#DED3BC', dark: '#3A3125' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#C6B89C', dark: '#4E4231' },
      '--dsw-alias-markdown-inline-code': { light: '#E6E0D1', dark: '#2D261C' },
      '--dsw-alias-menu-icon': { light: '#5E4F3A', dark: '#B7AA93' },
    },
  },
  {
    id: 'azure',
    name: '晴蓝',
    note: '亮白底 + 天蓝强调，暗档转深蓝墨',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F2F8FD', dark: '#0A1420' },
      '--dsw-alias-bg-layer-1': { light: '#FBFDFF', dark: '#0F1C2B' },
      '--dsw-alias-bg-layer-2': { light: '#E9F3FB', dark: '#152638' },
      '--dsw-alias-bg-layer-3': { light: '#D9EAF7', dark: '#1D3348' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#12202F' },
      '--dsw-alias-settings-card-fill': { light: '#F5FAFE', dark: '#0D1926' },
      '--dsw-alias-label-primary': { light: '#0E2233', dark: '#E2EEF8' },
      '--dsw-alias-label-primary-dimmed': { light: '#2F4E66', dark: '#BBD1E3' },
      '--dsw-alias-label-secondary': { light: '#45657E', dark: '#9AB6CC' },
      '--dsw-alias-label-tertiary': { light: '#6A89A2', dark: '#7691A8' },
      '--dsw-alias-label-primary-inverted': { light: '#F5FAFF', dark: '#0A1420' },
      '--dsw-alias-link': { light: '#0B63A8', dark: '#7FC4F5' },
      '--dsw-alias-border-l1': { light: '#D2E4F1', dark: '#24384D' },
      '--dsw-alias-border-l2': { light: '#B8D5E8', dark: '#31485F' },
      '--dsw-alias-separator-primary': { light: '#DDEAF5', dark: '#1E3348' },
      '--dsw-alias-brand-primary': { light: '#0E6FB4', dark: '#6FC1F0' },
      '--dsw-alias-brand-text': { light: '#0A4E7C', dark: '#A9DAF8' },
      '--dsw-alias-state-business-primary': { light: '#0E6FB4', dark: '#6FC1F0' },
      '--dsw-alias-button-primary-fill': { light: '#0E6FB4', dark: '#6FC1F0' },
      '--dsw-alias-button-primary-hover': { light: '#0A568C', dark: '#92CEF7' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#C7DCEC', dark: '#24384D' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#A6C6DE', dark: '#35506B' },
      '--dsw-alias-markdown-inline-code': { light: '#DEE6ED', dark: '#19232F' },
      '--dsw-alias-menu-icon': { light: '#45657E', dark: '#9AB6CC' },
    },
  },
  {
    id: 'plum',
    name: '暮紫',
    note: '紫调：亮档灰紫、暗档墨紫',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F7F4FB', dark: '#150F1E' },
      '--dsw-alias-bg-layer-1': { light: '#FCFBFE', dark: '#1C1527' },
      '--dsw-alias-bg-layer-2': { light: '#F0ECF7', dark: '#241B32' },
      '--dsw-alias-bg-layer-3': { light: '#E4DCF0', dark: '#2F2441' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#20182D' },
      '--dsw-alias-settings-card-fill': { light: '#F8F5FC', dark: '#191225' },
      '--dsw-alias-label-primary': { light: '#1E1630', dark: '#EDE6F6' },
      '--dsw-alias-label-primary-dimmed': { light: '#443658', dark: '#D2C6E2' },
      '--dsw-alias-label-secondary': { light: '#5C4B73', dark: '#B2A3C6' },
      '--dsw-alias-label-tertiary': { light: '#7E6E93', dark: '#8B7A9E' },
      '--dsw-alias-label-primary-inverted': { light: '#F8F5FD', dark: '#150F1E' },
      '--dsw-alias-link': { light: '#6A35A8', dark: '#C9A2F0' },
      '--dsw-alias-border-l1': { light: '#DED4EB', dark: '#33284A' },
      '--dsw-alias-border-l2': { light: '#C8BADB', dark: '#443560' },
      '--dsw-alias-separator-primary': { light: '#EAE3F3', dark: '#2A2039' },
      '--dsw-alias-brand-primary': { light: '#6E3FA8', dark: '#C39AEE' },
      '--dsw-alias-brand-text': { light: '#4E2A78', dark: '#DCC4F7' },
      '--dsw-alias-state-business-primary': { light: '#6E3FA8', dark: '#C39AEE' },
      '--dsw-alias-button-primary-fill': { light: '#6E3FA8', dark: '#C39AEE' },
      '--dsw-alias-button-primary-hover': { light: '#592F89', dark: '#D3B2F4' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#DCD3EA', dark: '#33284A' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#C4B5DA', dark: '#47385F' },
      '--dsw-alias-markdown-inline-code': { light: '#E5DEED', dark: '#241A31' },
      '--dsw-alias-menu-icon': { light: '#5C4B73', dark: '#B2A3C6' },
    },
  },
  {
    id: 'pine',
    name: '松墨',
    note: '青绿松墨：亮档薄荷纸、暗档近黑绿',
    tokens: {
      '--dsw-alias-bg-base': { light: '#F0F6F4', dark: '#0C1614' },
      '--dsw-alias-bg-layer-1': { light: '#FAFDFC', dark: '#111D1A' },
      '--dsw-alias-bg-layer-2': { light: '#E6F0ED', dark: '#172824' },
      '--dsw-alias-bg-layer-3': { light: '#D5E6E1', dark: '#1F352F' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#14201D' },
      '--dsw-alias-settings-card-fill': { light: '#F4FAF8', dark: '#0F1A17' },
      '--dsw-alias-label-primary': { light: '#0F221E', dark: '#E0EFE9' },
      '--dsw-alias-label-primary-dimmed': { light: '#2F4A44', dark: '#BAD3CB' },
      '--dsw-alias-label-secondary': { light: '#44635C', dark: '#9AB9B0' },
      '--dsw-alias-label-tertiary': { light: '#688078', dark: '#74928A' },
      '--dsw-alias-label-primary-inverted': { light: '#F4FAF8', dark: '#0C1614' },
      '--dsw-alias-link': { light: '#0F6B57', dark: '#7FD8BE' },
      '--dsw-alias-border-l1': { light: '#CFE5DF', dark: '#223A34' },
      '--dsw-alias-border-l2': { light: '#B2D2CA', dark: '#2F4F47' },
      '--dsw-alias-separator-primary': { light: '#DEEDE9', dark: '#1D322C' },
      '--dsw-alias-brand-primary': { light: '#14705A', dark: '#6FD3B8' },
      '--dsw-alias-brand-text': { light: '#0C4C3D', dark: '#A6E5D0' },
      '--dsw-alias-state-business-primary': { light: '#14705A', dark: '#6FD3B8' },
      '--dsw-alias-button-primary-fill': { light: '#14705A', dark: '#6FD3B8' },
      '--dsw-alias-button-primary-hover': { light: '#0E5546', dark: '#8FE0C9' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#C6DED8', dark: '#223A34' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#A5C8C0', dark: '#32534A' },
      '--dsw-alias-markdown-inline-code': { light: '#DAE9E4', dark: '#172A26' },
      '--dsw-alias-menu-icon': { light: '#44635C', dark: '#9AB9B0' },
    },
  },
  {
    id: 'contrast',
    name: '高对比',
    note: '黑白两极：边界最硬，弱视友好',
    tokens: {
      '--dsw-alias-bg-base': { light: '#FFFFFF', dark: '#000000' },
      '--dsw-alias-bg-layer-1': { light: '#FFFFFF', dark: '#0A0A0A' },
      '--dsw-alias-bg-layer-2': { light: '#F2F2F2', dark: '#141414' },
      '--dsw-alias-bg-layer-3': { light: '#E2E2E2', dark: '#1F1F1F' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#0D0D0D' },
      '--dsw-alias-settings-card-fill': { light: '#FAFAFA', dark: '#080808' },
      '--dsw-alias-label-primary': { light: '#000000', dark: '#FFFFFF' },
      '--dsw-alias-label-primary-dimmed': { light: '#1F1F1F', dark: '#E6E6E6' },
      '--dsw-alias-label-secondary': { light: '#333333', dark: '#CCCCCC' },
      '--dsw-alias-label-tertiary': { light: '#5C5C5C', dark: '#A6A6A6' },
      '--dsw-alias-label-primary-inverted': { light: '#FFFFFF', dark: '#000000' },
      '--dsw-alias-link': { light: '#0033CC', dark: '#8AB4FF' },
      '--dsw-alias-border-l1': { light: '#BFBFBF', dark: '#4D4D4D' },
      '--dsw-alias-border-l2': { light: '#9A9A9A', dark: '#6E6E6E' },
      '--dsw-alias-separator-primary': { light: '#CCCCCC', dark: '#3A3A3A' },
      '--dsw-alias-brand-primary': { light: '#000000', dark: '#FFFFFF' },
      '--dsw-alias-brand-text': { light: '#000000', dark: '#FFFFFF' },
      '--dsw-alias-state-business-primary': { light: '#111111', dark: '#F2F2F2' },
      '--dsw-alias-button-primary-fill': { light: '#000000', dark: '#FFFFFF' },
      '--dsw-alias-button-primary-hover': { light: '#1A1A1A', dark: '#E6E6E6' },
      '--dsw-alias-scrollbar-bg-l1': { light: '#B3B3B3', dark: '#4D4D4D' },
      '--dsw-alias-scrollbar-hover-l1': { light: '#8C8C8C', dark: '#6E6E6E' },
      '--dsw-alias-markdown-inline-code': { light: '#EDEDED', dark: '#0F0F0F' },
      '--dsw-alias-menu-icon': { light: '#1F1F1F', dark: '#CCCCCC' },
    },
  },
];

/**
 * @param {string} id
 * @returns {object|null} 找不到返回 null（调用方负责如实显示"未知皮肤"，不许回落成默认值冒充）
 */
export function skinById(id) {
  return SKINS.find((s) => s.id === id) ?? null;
}

/**
 * 选择器要画的那几项：**「不覆盖」排第一** + 各张皮肤。顺序即界面顺序。
 *
 * 为什么「不覆盖」在最前（用户 2026-10-04 要求）：它是"什么都不叠"的现状项，而进来默认就选中它
 * —— 默认选中项排在最前，用户一眼就能对上"现在生效的是第一张"；皮肤是"要额外叠的东西"，
 * 排在它后面像一排可选项。放最后的话默认项反而在末尾，扫一眼会以为选中的是别张。
 */
export function skinChoices() {
  return [
    { id: SKIN_NONE_ID, name: '不覆盖', note: '去掉本插件的配色，回到内置外观', tokenCount: 0 },
    ...SKINS.map((s) => ({ id: s.id, name: s.name, note: s.note, tokenCount: Object.keys(s.tokens).length })),
  ];
}

/**
 * 折成宿主 `overrideTokens` 要的层形状。
 * 原样透传 `{light, dark}` —— 这里不做任何"缺一档就补另一档"的兜底，
 * 补了就把写表时的漏档变成运行时看不见的暗病（宿主明说要两档）。
 */
export function overrideLayer(skin) {
  return { ...skin.tokens };
}
