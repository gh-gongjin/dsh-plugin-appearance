/**
 * test/api-shape.mjs —— 真机 GET-only 复核：挂上去的那一份到底是不是现在这一份。
 *
 * 为什么要单独一条：POST /appearance/api/report 在真机上落下来的 lastReport 只有 `{at}`，
 * 白名单字段一个都没进 —— 而离线用例喂的是普通对象与 JSON 字符串，两种都吃得下，
 * 于是"通道坏了"这件事在几十条断言里是隐形的。缺的是真机那一份形状读数，不是再多写几种猜测的解析分支。
 *
 * 跑法：`node test/api-shape.mjs [端口]`（默认 19387，需要 dsh desktop 正在跑、插件已挂载）。
 * 全程只 GET：不改宿主状态、不 POST（真机探针铁律 —— 曾经有探针漏了 `.data` 信封把 prefs 整行覆盖成空）。
 * 代价：本脚本自己不发 report，所以它读到的仍是上一次落下来的那条；
 * 想看新的就回界面点一下（那是用户操作，不是脚本操作）。
 */
import assert from 'node:assert/strict';
import { SKINS, SKIN_NONE_ID } from '../lib/skins.js';
import { BRAND_MARKS, BRAND_MODE_OFF } from '../lib/marks.js';

const BASE = `http://127.0.0.1:${process.argv[2] || '19387'}`;

const r = await fetch(`${BASE}/appearance/api/state`);
const text = await r.text();
let json = null;
try { json = JSON.parse(text); } catch { /* 原样打出去看 */ }

console.log(`GET ${BASE}/appearance/api/state → ${r.status}`);
console.log('content-type:', r.headers.get('content-type'));
console.log('信封:', json && typeof json === 'object' ? `ok=${json.ok} data=${json.data ? '有' : '无'}` : '(不是 JSON)');

if (!json?.ok || !json.data) {
  console.log('\n原文前 400 字符：\n' + text.slice(0, 400));
  process.exit(1);
}
const d = json.data;
console.log('data 键:', Object.keys(d).join(', '));
console.log('皮肤:', d.skins?.map((s) => `${s.id}:${s.tokenCount}`).join(' '));
console.log('标志:', d.marks?.map((m) => m.id).join(' '));
console.log('默认:', `skinId=${d.defaultSkinId} brandMode=${d.defaultBrandMode}`, '存档:', JSON.stringify(d.store));
console.log('lastReport:', JSON.stringify(d.lastReport ?? null));
console.log('builtAt:', d.builtAt, '（宿主半边进程起来的时刻；lastReport.at 比它早 ⇒ 那条是上一轮会话留下的）');

// 载荷通道本身：这一条与 lastReport 无关，先钉住"挂上去的是现在这一份"。
assert.deepEqual(d.skins.map((s) => s.id), SKINS.map((s) => s.id), '皮肤表形状不对（挂的还是旧的一份？）');
assert.deepEqual(d.skins.map((s) => s.tokenCount), SKINS.map(() => 24), '皮肤令牌数不对');
assert.deepEqual(d.marks.map((m) => m.id), BRAND_MARKS.map((m) => m.id), '内置标志清单不对');
assert.equal(d.defaultSkinId, SKIN_NONE_ID, '默认皮肤必须是"不覆盖"');
assert.equal(d.defaultBrandMode, BRAND_MODE_OFF, '默认标志档位必须是"原样"');

// 回报通道：字段是那六个，一条不落。
const rep = d.lastReport;
if (!rep) {
  console.log('\n结论：lastReport 还没有 —— 在界面上点一张皮肤（用户操作）再重跑本脚本。');
} else {
  assert.deepEqual(Object.keys(rep).sort(), ['applied', 'at', 'error', 'logo', 'scheme', 'skinId', 'spots'],
    `回报字段对不上白名单：${Object.keys(rep).join(', ')}`);
  console.log('结论：' + (rep.spots && rep.skinId
    ? `上一轮回报是 skinId=${rep.skinId} applied=${rep.applied} scheme=${rep.scheme} logo=${rep.logo}｜spots=${rep.spots}`
    : '回报通道通，但那条是默认档（未点过）：' + JSON.stringify(rep)));
}
