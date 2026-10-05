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

check('sk-11 夹具自身：120 条去重后仍 120，三条前缀伪项按尾字符规则剔出', () => {
  assert.equal(rawTokens.length, 120, `夹具行数变了：${rawTokens.length}（宿主升级要重采）`);
  assert.equal(new Set(rawTokens).size, rawTokens.length, '夹具里有重复行');
  assert.equal(artifacts.length, 3, `前缀伪项应为 3 条，实得 ${artifacts.length}：${artifacts.join(', ')}`);
  assert.equal(hostTokens.size, 117);
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
