/**
 * lib/schema.js —— 极小的记录校验器 + domain 声明，只为满足宿主 `ctx.storageDomain` 的调用面。
 *
 * 为什么不 import 官方的 `@deepseek-ai/dsh-storage-domain`：本插件以 `link:` 挂在 profile 下，
 * 一旦引内部包，Node 会从插件自己的 node_modules 解析出**第二份模块实例**，模块私有状态不共享。
 * 而官方实现里零 `instanceof` 检查：`open(spec)` 只读 `spec.name / tables / global /
 * invalidRecords / layout / compatibleVersions`，`defineDomain` 只做形状校验然后原样返回入参。
 * 所以这里自造一个形状相同的等价物（口径照 dsh-plugin-stock-analysis/lib/kv-schema.js，
 * 那份已在真机跑通过；只留本插件用得到的六个校验器，不搬一整套类型系统）。
 *
 * 校验失败的记录要么进不来（写前 parse），要么在 `open()` 时被指名道姓地报出来，
 * 绝不静默接受。
 */

const FAIL = Symbol('schema.fail');

function safe(validate, value) {
  try {
    const data = validate(value);
    if (data === FAIL) return { success: false, error: new Error('校验未通过') };
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** 把校验函数包成宿主认识的样子：只有 `.parse` 与 `.safeParse` 两面。 */
export function makeSchema(validate) {
  return {
    safeParse(value) { return safe(validate, value); },
    parse(value) {
      const result = safe(validate, value);
      if (!result.success) throw result.error;
      return result.data;
    },
  };
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 必填字符串，空串视为未填。
 * @param opts.maxLength 给了就限长。**超长是报错不是截断** —— 截断会把用户存的东西
 *   悄悄改成半截，而他还以为自己存的是完整那份。
 */
export const requiredString = (label, opts = {}) => {
  const max = Number(opts.maxLength);
  return makeSchema((v) => {
    if (typeof v !== 'string' || v === '') throw new Error(`${label} 必填，且必须是非空字符串`);
    if (Number.isFinite(max) && max > 0 && v.length > max) {
      throw new Error(`${label} 过长（${v.length} 字，上限 ${max} 字）`);
    }
    return v;
  });
};

/** 可选字符串；缺省或空串都归一成 undefined，不留空壳字段。 */
export const optionalString = (label, opts = {}) => {
  const max = Number(opts.maxLength);
  return makeSchema((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') throw new Error(`${label} 必须是字符串`);
    if (Number.isFinite(max) && max > 0 && v.length > max) {
      throw new Error(`${label} 过长（${v.length} 字，上限 ${max} 字）`);
    }
    return v;
  });
};

/**
 * 可选整数。`updatedAt` 这类由**仓储**统一加盖的字段必须用可选：
 * 改成必填等于逼每个调用方去碰一个跟业务无关的字段，漏了就写不进去，
 * 而这种失败看起来像"数据非法"，很难查。
 */
export const optionalInt = (label) =>
  makeSchema((v) => {
    if (v === undefined || v === null) return undefined;
    if (!Number.isInteger(v)) throw new Error(`${label} 必须是整数`);
    return v;
  });

/**
 * 固定字段的记录体。**未在 shape 里声明的字段会被丢弃**，不是原样保留 ——
 * 多出来的字段说明写入方与 schema 已经不同步了，与其默默存下去，不如让它存不进来。
 */
export const record = (shape, label = '记录') =>
  makeSchema((v) => {
    if (!isPlainObject(v)) throw new Error(`${label} 必须是对象`);
    const out = {};
    for (const [key, schema] of Object.entries(shape)) {
      const parsed = schema.parse(v[key]);
      if (parsed !== undefined) out[key] = parsed;
    }
    return out;
  });

/** 声明一张表：官方 `domainTable` 就是包一层 `valueSchema`。 */
export const domainTable = (schema) => ({ valueSchema: schema });

/** 官方 dsh-storage/lib/index.js:80 的同一份规则（domain 名与表名都要匹配）。 */
export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** 声明一个 domain。该校验的地方一处不少，但不依赖官方包的实例；失败在模块加载期就炸。 */
export function defineDomain(spec) {
  if (!UNIT_NAME_RE.test(spec.name)) {
    throw new Error(`domain 名 '${spec.name}' 必须匹配 ${UNIT_NAME_RE}`);
  }
  if (!Number.isInteger(spec.version) || spec.version < 0) {
    throw new Error(`domain '${spec.name}' 的 version 必须是非负整数，收到 ${spec.version}`);
  }
  if (!isPlainObject(spec.tables)) {
    throw new Error(`domain '${spec.name}' 必须给出 tables`);
  }
  for (const table of Object.keys(spec.tables)) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new Error(`domain '${spec.name}' 的表名 '${table}' 必须匹配 ${UNIT_NAME_RE}`);
    }
  }
  return spec;
}
