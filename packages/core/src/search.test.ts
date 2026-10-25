import { describe, expect, it } from 'vitest'
import { findCritical, formatCritical } from './search'

describe('临界搜索（粗扫 + 二分）', () => {
  it('单调谓词能收敛到解析解', async () => {
    // f(x) = x² > 2 的翻转点 = √2
    const out = await findCritical({
      range: [0, 3],
      samples: 32,
      precision: 1e-4,
      run: async (x) => x * x > 2,
    })
    expect(out.flips).toHaveLength(1)
    expect(Math.abs(out.flips[0]!.critical - Math.SQRT2)).toBeLessThan(1e-3)
    expect(out.runs).toBeLessThan(80)
  })

  it('非单调也能报出所有翻转区间', async () => {
    const out = await findCritical({
      range: [-2, 2],
      samples: 40,
      precision: 1e-3,
      run: async (x) => Math.abs(x) < 0.5,
    })
    expect(out.flips.length).toBe(2)
  })

  it('可以中途取消', async () => {
    let aborted = false
    const out = await findCritical({
      range: [0, 1],
      samples: 16,
      run: async () => {
        aborted = true
        return false
      },
      isAborted: () => aborted,
    })
    expect(out.aborted).toBe(true)
  })

  it('临界值按有效数字格式化（跨设备差异的诚实处理）', () => {
    expect(formatCritical(5.203881, 3)).toBe('5.20')
    expect(formatCritical(0.0249, 2)).toBe('0.025')
  })
})
