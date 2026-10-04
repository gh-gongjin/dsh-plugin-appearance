/**
 * test/run-all.mjs —— 全量门禁：逐个跑离线套件，任一红就 exit 1。
 *
 * 本插件目前**没有真机用例**（骨架阶段全部离线可判），所以没有 SKIP_LOCAL 分支；
 * 真机复核走 GET-only 探针，见 docs/design-spec.md §6。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = ['test/skins.test.mjs', 'test/plugin.test.mjs', 'test/client.test.mjs'];

let failed = 0;
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync(process.execPath, [path.join(ROOT, suite)], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}
console.log(`\nrun-all: ${SUITES.length - failed}/${SUITES.length} 套件通过`);
process.exit(failed ? 1 : 0);
