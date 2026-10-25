// 把 core + physics + render + ui 打成一个 CJS 文件，给小程序壳 require。
// 不依赖小程序的 npm 构建（node_modules 在小程序里要走「构建 npm」，这里直接产出一个文件）。
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'

const root = process.cwd()
const dirs = {
  core: path.join(root, 'packages/core/src'),
  physics: path.join(root, 'packages/physics/src'),
  render: path.join(root, 'packages/render/src'),
  ui: path.join(root, 'packages/ui/src'),
}

const aliasPlugin = {
  name: 'phys-alias',
  setup(b) {
    b.onResolve({ filter: /^@(core|physics|render|ui)\// }, (args) => {
      const m = args.path.match(/^@(core|physics|render|ui)\/(.+)$/)
      if (!m) return null
      const base = path.join(dirs[m[1]], m[2])
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const p = base + ext
        if (fs.existsSync(p)) return { path: p }
      }
      return { path: base }
    })
  },
}

const outfile = path.join(root, 'apps/miniprogram/miniprogram/utils/app.js')
fs.mkdirSync(path.dirname(outfile), { recursive: true })

const result = await build({
  entryPoints: [path.join(root, 'packages/ui/src/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2017',
  minify: true,
  // 默认 charset 是 ascii：中文会被转义成 \uXXXX（一个汉字 3 字节变 6 字节）。
  // 这个 App 的界面文案全是中文，转义后白白多出几十 KB。
  charset: 'utf8',
  legalComments: 'none',
  sourcemap: false,
  outfile,
  plugins: [aliasPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
  metafile: true,
})

const bytes = fs.statSync(outfile).size
console.log(`\n小程序包：${(bytes / 1024).toFixed(1)} KB → ${path.relative(root, outfile)}`)
if (bytes > 2 * 1024 * 1024) {
  console.error('超过单包 2 MB 限制')
  process.exit(1)
}
void result
