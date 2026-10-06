/**
 * test/skins.test.mjs —— 皮肤定义表对真机令牌清单的符合性。
 *
 * 这份用例的全部价值在 sk-2 与 sk-10：前者钉"我写的令牌名在真机那份构建里存在"，
 * 后者钉"明暗两档各自可读"（写错一档的颜色，界面会黑底黑字，而这种错在只测一档的用例里看不见）。
 * 夹具 host-tokens.txt 是从 `D:\Deepseek harness desktop\resources\app.asar`（0.2.0-rc.2）
 * 抽出来的 120 个 --dsw-alias-*；宿主升级后要重采（0.1.7 只有 99 个，这份表不许假设它不变）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, SKIN_NONE_ID, DEFAULT_SKIN_ID, skinById, skinChoices, overrideLayer } from '../lib/skins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'host-tokens.txt');
/** 宿主内置配色的**实际值**（真机抽出）—— sk-13 的判据要拿它当基准（见那段注释）。 */
const hostValues = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'host-token-values.json'), 'utf8'));

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn(); passed += 1; console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
}

const rawTokens = fs.readFileSync(FIXTURE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
/** 尾字符是连字符的是 bundle 里模板串拼接出来的前缀，不是真令牌名（三条：file-diff- / scrollbar- / turn-trigger-）。 */
const artifacts = rawTokens.filter((t) => t.endsWith('-'));
const hostTokens = new Set(rawTokens.filter((t) => !t.endsWith('-')));

check('sk-1 皮肤 id 唯一；默认档就是"不覆盖"（进来原样这条裁定钉在表上）', () => {
  const ids = SKINS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `皮肤 id 有重复：${ids.join(',')}`);
  assert.equal(DEFAULT_SKIN_ID, SKIN_NONE_ID, '默认档必须是"不覆盖"：用户 2026-10-03 要求进来是原样，皮肤要他点过才动');
  assert.equal(skinById(DEFAULT_SKIN_ID), null, 'SKIN_NONE_ID 不该出现在皮肤表里（它表示"不套任何层"，不是一张皮肤）');
  for (const id of ids) assert.ok(skinById(id), `${id} 查不回来`);
  assert.equal(skinById('nope-not-a-skin'), null, 'skinById 找不到时必须返回 null，不许回落默认值');
});

check('sk-1b 内置皮肤 7 张以上（用户 2026-10-03 要求 7-8 个）', () => {
  assert.ok(SKINS.length >= 7, `内置皮肤只有 ${SKINS.length} 张，不够用户要的那 7-8 档`);
  assert.ok(SKINS.length <= 8, `内置皮肤扩到 ${SKINS.length} 张，超出"7-8 个"这一档，界面那一栏也得跟着看是否还排得下`);
});

check('sk-2 每个令牌名都在真机 0.2.0 清单里', () => {
  for (const skin of SKINS) {
    const unknown = Object.keys(skin.tokens).filter((t) => !hostTokens.has(t));
    assert.deepEqual(unknown, [], `${skin.id} 引用了清单外的令牌：${unknown.join(', ')}`);
  }
});

check('sk-3 每个令牌都是 {light, dark} 两个字符串', () => {
  for (const skin of SKINS) {
    for (const [token, modes] of Object.entries(skin.tokens)) {
      assert.ok(modes && typeof modes === 'object', `${skin.id} ${token} 不是对象`);
      assert.equal(typeof modes.light, 'string', `${skin.id} ${token} 缺 light 档`);
      assert.equal(typeof modes.dark, 'string', `${skin.id} ${token} 缺 dark 档`);
      assert.match(modes.light, /^(#|var\(|rgb|color-mix)/, `${skin.id} ${token}.light 不像 CSS 颜色值：${modes.light}`);
      assert.match(modes.dark, /^(#|var\(|rgb|color-mix)/, `${skin.id} ${token}.dark 不像 CSS 颜色值：${modes.dark}`);
    }
  }
});

check('sk-4 各张皮肤盖的是同一批槽位（换肤不许露出上一张的格子）', () => {
  const base = Object.keys(SKINS[0].tokens).sort();
  for (const skin of SKINS.slice(1)) {
    assert.deepEqual(Object.keys(skin.tokens).sort(), base, `${skin.id} 的令牌集合与 ${SKINS[0].id} 不一致`);
  }
});

check('sk-5 两档色值都写成十六进制且大小写归一（同表内口径统一，便于逐行比对）', () => {
  for (const skin of SKINS) {
    for (const [token, modes] of Object.entries(skin.tokens)) {
      for (const mode of ['light', 'dark']) {
        assert.match(modes[mode], /^#[0-9A-F]{6}$/, `${skin.id} ${token}.${mode} 应为 #RRGGBB 大写，收到 ${modes[mode]}`);
      }
    }
  }
});

check('sk-6 选择器第一项是"不覆盖"（进来默认生效的就是它），且 id 不与任何皮肤撞', () => {
  const choices = skinChoices();
  assert.equal(choices[0].id, SKIN_NONE_ID, '「不覆盖」该排第一：它是默认生效项，用户扫一眼要能把"现在这张"和第一张卡对上');
  assert.equal(choices.length, SKINS.length + 1, `项数对不上（皮肤 ${SKINS.length} + 不覆盖 1）：${choices.length}`);
  assert.equal(choices.filter((c) => c.id === SKIN_NONE_ID).length, 1);
  assert.equal(new Set(choices.map((c) => c.id)).size, choices.length);
  // 皮肤那几张的顺序不许被打乱（只是把"不覆盖"提到最前，不是重排皮肤表）。
  assert.deepEqual(choices.slice(1).map((c) => c.id), SKINS.map((s) => s.id), '皮肤表自己的顺序被改动了');
});

check('sk-7 overrideLayer 原样透传，绝不替缺档补一个', () => {
  const broken = { id: 'x', tokens: { '--dsw-alias-bg-base': { light: '#FFFFFF' } } };
  const layer = overrideLayer(broken);
  assert.deepEqual(Object.keys(layer), ['--dsw-alias-bg-base']);
  assert.equal('dark' in layer['--dsw-alias-bg-base'], false, '补档会把写表时的漏档藏到运行时');
});

check('sk-8 令牌集合非空且不超过真机清单规模（覆盖数要能如实报在界面上）', () => {
  for (const skin of SKINS) {
    const n = Object.keys(skin.tokens).length;
    assert.ok(n > 0 && n <= hostTokens.size, `${skin.id} 覆盖 ${n} 个，清单只有 ${hostTokens.size} 个`);
  }
});

/* ---- 可读性闸：明暗两档各自核对"文字 vs 底"，防止切档切出黑底黑字 ---- */
const hexLum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [hexLum(a), hexLum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const PAIRS = [
  ['--dsw-alias-label-primary', '--dsw-alias-bg-base'],
  ['--dsw-alias-label-secondary', '--dsw-alias-bg-layer-1'],
  ['--dsw-alias-brand-text', '--dsw-alias-bg-base'],
];

check('sk-9 每张皮肤两档的正文/次级/品牌文字对底都到 4.5:1（WCAG AA）', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      for (const [fgToken, bgToken] of PAIRS) {
        const fg = skin.tokens[fgToken]?.[mode];
        const bg = skin.tokens[bgToken]?.[mode];
        assert.ok(fg && bg, `${skin.id} 缺 ${fgToken} 或 ${bgToken}，可读性闸量不到`);
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5, `${skin.id} ${mode} 档 ${fgToken} on ${bgToken} = ${ratio.toFixed(2)}:1，低于 4.5`);
      }
    }
  }
});

check('sk-10 强调色按钮上的反白文字在每张皮肤两档都够亮/够暗（徽标留白同用这一档）', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      const ratio = contrast(skin.tokens['--dsw-alias-label-primary-inverted'][mode], skin.tokens['--dsw-alias-button-primary-fill'][mode]);
      assert.ok(ratio >= 4.5, `${skin.id} ${mode} 档 按钮反白文字 ${ratio.toFixed(2)}:1，低于 4.5`);
    }
  }
});

check('sk-11 夹具自身：131 条去重后仍 131，三条前缀伪项按尾字符规则剔出', () => {
  assert.equal(rawTokens.length, 131, `夹具行数变了：${rawTokens.length}（宿主升级要重采，见 tmp/extract-host-tokens.mjs）`);
  assert.equal(new Set(rawTokens).size, rawTokens.length, '夹具里有重复行');
  assert.equal(artifacts.length, 3, `前缀伪项应为 3 条，实得 ${artifacts.length}：${artifacts.join(', ')}`);
  assert.equal(hostTokens.size, 128);
});

/*
 * ---- 侧边栏专用令牌闸：宿主左边栏读的是另一套前缀 ----
 *
 * 用户 2026-10-06 真机截图报的：「换了配色，只有右边栏换了、左边栏没换，左边栏改不了吗」。
 * 根因不是通道限制（三段都核过：validateOverrides 只校验值的形态、不校验令牌名；
 * composeActive 无条件合并；落地是 body.style.setProperty(name, value) —— 任何 CSS 变量都写得上去），
 * 而是**皮肤表漏了一整套令牌**：宿主侧栏读 `--dsw-specific-sidebar-*`，
 * 而原来的 24 个覆盖**全是 `--dsw-alias-*`**（asar 原文：
 * `.BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3)}`）。
 * 夹具当时也只抽了 alias，所以 sk-2 永远发现不了这个缺口 —— 这次把 specific 一并采进来。
 *
 * 这条闸钉的是**这 4 个令牌都在、且按用途成立**（不钉具体色值）：
 *   ① 四个令牌名一个不缺（缺一个就从上一张皮肤露出内置灰）；
 *   ② 侧栏底与导航三态**逐级递增**（亮档越远越沉、暗档越远越亮）—— 方向反了 hover 会"跳回来"；
 *   ③ 真实用途上的字读得清：`label-primary` 落在 fill/hover/active 上（导航文字就压在这三处），
 *      以及**徽标**那格 —— `.mAtvLq_badge{background:var(--dsw-specific-sidebar-nav-item-active-accent);
 *      color:var(--dsw-alias-button-info-fill)}`，字色是别名层的中蓝，皮肤没覆盖它 ⇒ 用真机默认值兜底。
 */
const SIDEBAR = {
  fill: '--dsw-specific-sidebar-fill',
  hover: '--dsw-specific-sidebar-nav-item-hover',
  active: '--dsw-specific-sidebar-nav-item-active',
  accent: '--dsw-specific-sidebar-nav-item-active-accent',
};
/** 宿主**内置**的这 4 个值（真机夹具）—— 判据的基准，不是 4.5（见下面徽标那段说明）。 */
const hostS = (scheme, key) => hostValues[scheme][SIDEBAR[key]];
/** `rgb(65, 118, 230)` → `#4176e6`（真机夹具存的是 rgb 形式，本文件其余地方都是 hex）。 */
const rgbToHex = (v) => {
  const [r, g, b] = String(v).replace(/^rgb\(|\)$/g, '').split(',').map((n) => Number(n.trim()));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
};
const BADGE_FG = '--dsw-alias-button-info-fill';

check('sk-13 侧边栏 4 个令牌一张不缺、方向对、且真实用色处的字读得清（左边栏换肤靠的就是这一套）', () => {
  for (const skin of SKINS) {
    for (const key of Object.keys(SIDEBAR)) {
      const tok = SIDEBAR[key];
      const m = skin.tokens[tok];
      assert.ok(m && typeof m.light === 'string' && typeof m.dark === 'string',
        `${skin.id} 缺 ${tok}：宿主侧栏读这一套，不填它换肤只有主区变、左边栏不动`);
    }
    for (const scheme of ['light', 'dark']) {
      const v = (k) => skin.tokens[SIDEBAR[k]][scheme];
      // ② 方向：亮档越远越沉、暗档越远越亮；三态逐级递增
      const deeper = (x, y) => (scheme === 'light' ? hexLum(x) < hexLum(y) : hexLum(x) > hexLum(y));
      assert.ok(deeper(v('fill'), skin.tokens['--dsw-alias-bg-base'][scheme]),
        `${skin.id} ${scheme}: sidebar-fill 不在 bg-base 的"更远"一侧（侧栏会与主区糊成一片）`);
      assert.ok(deeper(v('hover'), v('fill')), `${skin.id} ${scheme}: hover 没比 fill 更远一档`);
      assert.ok(deeper(v('active'), v('hover')), `${skin.id} ${scheme}: active 没比 hover 更远一档`);
      // ③ 导航文字（label-primary）压在三个底上都要过 4.5:1 —— 这三处是侧栏里字最密的地方
      for (const k of ['fill', 'hover', 'active']) {
        const r = contrast(skin.tokens['--dsw-alias-label-primary'][scheme], v(k));
        assert.ok(r >= 4.5, `${skin.id} ${scheme}: 导航文字 on ${k} = ${r.toFixed(2)}:1，低于 4.5`);
      }
      // ③b 徽标：字色是 `--dsw-alias-button-info-fill`（皮肤不覆盖 ⇒ 用真机默认兜底）。
      //     目标是**不劣于宿主现状** —— 那个中蓝字色压在亮底上的对比上限只有 4.23:1
      //     （它的相对亮度 0.198 摆在那儿，数学上到不了 4.5），宿主自己也只有 3.60:1。
      //     硬卡 4.5 会让这条断言变成永假，量不到东西。
      const fgHex = rgbToHex(hostValues[scheme][BADGE_FG]);
      const floor = contrast(fgHex, rgbToHex(hostS(scheme, 'accent'))) - 0.15;
      const rBadge = contrast(fgHex, v('accent'));
      assert.ok(rBadge >= floor,
        `${skin.id} ${scheme}: 徽标字 on accent = ${rBadge.toFixed(2)}:1，低于宿主现状 ${floor.toFixed(2)}`);
      // ③c 徽标那块底得**看得见**（与侧栏底不完全相同）
      assert.ok(contrast(v('accent'), v('fill')) > 1.005,
        `${skin.id} ${scheme}: accent 与 sidebar-fill 完全同色，徽标那块底会消失`);
    }
  }
});

check('sk-13b 反向：把 4 个侧边栏令牌剥掉后，sk-13 的第一条断言必须不成立（否则那条闸是摆设）', () => {
  const stripped = SKINS.map((s) => Object.fromEntries(
    Object.entries(s.tokens).filter(([k]) => !Object.values(SIDEBAR).includes(k)),
  ));
  const missing = stripped.flatMap((tk) => Object.values(SIDEBAR).filter((t) => !tk[t]));
  assert.equal(missing.length, SKINS.length * 4,
    `剥掉侧边栏令牌后应当缺 ${SKINS.length * 4} 个，实得 ${missing.length}：这条反向判据本身要能成立`);
});

/*
 * ---- 令牌用途闸：按「用途」填，不许按名字猜 ----
 *
 * 用户 2026-10-05 报的真机 bug：换肤后正文里的行内代码变成**实心深蓝方块、字看不见**。
 * 根因不是"颜色没挑好"，而是**把底色的令牌当字色填了**：
 * `--dsw-alias-markdown-inline-code` 名字像字色，实际宿主只拿它做 `background-color`
 * （asar 原文：`.markdown code{background-color:var(--dsw-alias-markdown-inline-code)}`）。
 * 第一版填 `light:#1B3D6B / dark:#C8DAF6` —— 亮档深底配深字、暗档浅底配浅字，两头都看不见。
 *
 * 这条闸钉的不是"某个色值"，是**这个令牌的形态必须是"底"**：
 *   ① 正文落在它上面够读（≥4.5:1）—— 填成字色时这条当场红（深藏蓝 vs 正文 #101A2B 只有 ~1.5:1）；
 *   ② 与页面底拉得开（芯片得看得见）；
 *   ③ 方向对：亮档比 bg-base 更沉、暗档比 bg-base 更亮 —— 这才是"压下去的一块底"。
 */
const CODE_BG = '--dsw-alias-markdown-inline-code';

check('sk-12 markdown-inline-code 是行内代码的「底」不是「字」（令牌名会骗人，用途由真机 CSS 定）', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      const codeBg = skin.tokens[CODE_BG]?.[mode];
      const text = skin.tokens['--dsw-alias-label-primary'][mode];
      const base = skin.tokens['--dsw-alias-bg-base'][mode];
      assert.ok(codeBg, `${skin.id} 缺 ${CODE_BG}，这条闸就量不到了`);

      // ① 它是底 ⇒ 正文压在上面必须能读。填成字色（深底深字）时这条最先红。
      const onCode = contrast(text, codeBg);
      assert.ok(
        onCode >= 4.5,
        `${skin.id} ${mode} 档 正文落在 ${CODE_BG}(${codeBg}) 上只有 ${onCode.toFixed(2)}:1 —— 这个令牌是行内代码的【底】，被当成字色填就会同色叠同色（真机 bug 的形态）`,
      );

      // ② 它是"芯片底" ⇒ 得与页面底拉得开，否则那块底看不见（填成 bg-base 本身就会踩这条）。
      const chip = contrast(codeBg, base);
      assert.ok(
        chip >= 1.05,
        `${skin.id} ${mode} 档 ${CODE_BG}(${codeBg}) 与 bg-base(${base}) 几乎同色（${chip.toFixed(3)}:1），行内代码的底看不出来`,
      );

      // ③ 方向：亮档要更沉、暗档要更亮 —— 把"底"这个形态本身钉死（填反了就成了另一块高光）。
      const dL = hexLum(codeBg) - hexLum(base);
      if (mode === 'light') {
        assert.ok(dL < 0, `${skin.id} 亮档 ${CODE_BG}(${codeBg}) 该比 bg-base(${base}) 更沉，实测更亮（ΔL=${dL.toFixed(3)}）`);
      } else {
        assert.ok(dL > 0, `${skin.id} 暗档 ${CODE_BG}(${codeBg}) 该比 bg-base(${base}) 更亮，实测更沉（ΔL=${dL.toFixed(3)}）`);
      }
    }
  }
});

console.log(`\nskins: ${passed} 过 / ${failures.length} 挂`);
process.exit(failures.length ? 1 : 0);
