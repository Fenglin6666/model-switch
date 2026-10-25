/**
 * 临界搜索：粗扫 + 二分（架构 §7.2）。
 *
 * 三个工程前提都在这里落地：
 * 1. 确定性——`run(value)` 必须由固定步长仿真驱动，不接受随机；
 * 2. headless——`run` 只返回 pass/fail，不渲染、不算图表；
 * 3. 提前终止——由 `run` 内部负责（判据触发即停）。
 *
 * core 不依赖物理包：仿真器以回调注入。
 */
export type SearchSample = { value: number; pass: boolean }

export type CriticalFlip = {
  from: number
  to: number
  /** 翻转点（相对精度内） */
  critical: number
  passFrom: boolean
  passTo: boolean
  /** 二分次数 */
  iterations: number
}

export type SearchOutcome = {
  samples: SearchSample[]
  flips: CriticalFlip[]
  runs: number
  aborted: boolean
}

export type SearchOptions = {
  range: [number, number]
  /** 粗扫点数，默认 32 */
  samples?: number
  /** 相对精度，默认 1e-4 */
  precision?: number
  /** 每次采样调用一次仿真 */
  run: (value: number) => Promise<boolean>
  onProgress?: (done: number, total: number) => void
  isAborted?: () => boolean
  /** 每跑多少次让出一次事件循环，避免 UI 卡死 */
  yieldEvery?: number
  /** 二分次数上限，保护异常情况 */
  maxIterations?: number
}

export async function findCritical(opts: SearchOptions): Promise<SearchOutcome> {
  const [a0, b0] = opts.range
  const n = Math.max(3, opts.samples ?? 32)
  const precision = opts.precision ?? 1e-4
  const maxIterations = opts.maxIterations ?? 40
  const yieldEvery = opts.yieldEvery ?? 4
  let runs = 0
  let aborted = false

  const coarse: SearchSample[] = []
  const totalCoarse = n
  for (let i = 0; i < n; i++) {
    if (opts.isAborted?.()) {
      aborted = true
      break
    }
    const value = a0 + ((b0 - a0) * i) / (n - 1)
    const pass = await opts.run(value)
    runs++
    coarse.push({ value, pass })
    opts.onProgress?.(i + 1, totalCoarse)
    if (runs % yieldEvery === 0) await tick()
  }

  const flips: CriticalFlip[] = []
  if (!aborted) {
    for (let i = 1; i < coarse.length; i++) {
      const left = coarse[i - 1]!
      const right = coarse[i]!
      if (left.pass === right.pass) continue
      const flip = await bisect(left, right, opts, precision, maxIterations)
      if (flip) {
        runs += flip.iterations
        flips.push(flip)
      }
      if (opts.isAborted?.()) {
        aborted = true
        break
      }
      await tick()
    }
  }

  return { samples: coarse, flips, runs, aborted }
}

async function bisect(
  left: SearchSample,
  right: SearchSample,
  opts: SearchOptions,
  precision: number,
  maxIterations: number,
): Promise<CriticalFlip | null> {
  let lo = left
  let hi = right
  let iterations = 0
  while (iterations < maxIterations) {
    const span = Math.abs(hi.value - lo.value)
    const scale = Math.max(1, Math.abs(lo.value), Math.abs(hi.value))
    if (span <= precision * scale) break
    const mid = (lo.value + hi.value) / 2
    const pass = await opts.run(mid)
    iterations++
    if (pass === lo.pass) lo = { value: mid, pass }
    else hi = { value: mid, pass }
  }
  return {
    from: left.value,
    to: right.value,
    critical: (lo.value + hi.value) / 2,
    passFrom: left.pass,
    passTo: right.pass,
    iterations,
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 按有效数字格式化临界值（跨设备差异的诚实处理，架构 §7.4） */
export function formatCritical(value: number, sig = 3): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(0)
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)))
  return value.toFixed(Math.min(4, digits))
}

/** 相对误差 */
export function relError(actual: number, expected: number): number {
  const scale = Math.max(Math.abs(expected), 1e-9)
  return Math.abs(actual - expected) / scale
}
