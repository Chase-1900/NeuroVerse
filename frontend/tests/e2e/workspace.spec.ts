import { expect, test } from '@playwright/test'

const seedDemo = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => localStorage.setItem('neuroverse.view.demo', 'true'))
}

test('首页进入三维宇宙，搜索、选中、缩放和重置', async ({ page }) => {
  await page.route('**/api/v1/sessions', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /你的思想/ })).toBeVisible()
  await page.getByRole('link', { name: '浏览离线示例' }).click()
  await expect(page.locator('.scene-host canvas')).toBeVisible()
  const index = page.getByRole('complementary', { name: '星球索引' })
  await index.getByRole('button', { name: /^TCP \d+%$/ }).click()
  await expect(page.getByRole('heading', { name: 'TCP', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '放大' }).click()
  await page.getByRole('button', { name: '重置视图' }).click()
  await page.getByLabel('搜索星球').fill('不存在的标题')
  await expect(page.getByRole('heading', { name: '没有符合条件的星球' })).toBeVisible()
})

test('无 WebGL 时仍可导入、查看原文、编辑、碰撞并复习', async ({ page }) => {
  await seedDemo(page)
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type.startsWith('webgl')) return null
      return Reflect.apply(original, this, [type, options])
    } as typeof original
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/universe')
  await expect(page.getByText(/无法启动 WebGL/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '导入知识' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('粘贴文本').check()
  await dialog.getByLabel(/资料文本/).fill('星际通信使用确认与重传保证消息送达。')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '开始导入' }).click()
  await expect(dialog.getByText('导入完成')).toBeVisible({ timeout: 12_000 })
  await dialog.getByRole('link', { name: '进入宇宙' }).click()
  const index = page.getByRole('complementary', { name: '星球索引' })
  await index.getByRole('button', { name: /^TCP \d+%$/ }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel(/摘要（最多/).fill('确认和重传保证可靠传输。')
  await page.getByRole('button', { name: '保存更改' }).click()
  await expect(page.getByText('确认和重传保证可靠传输。').last()).toBeVisible()
  await index.getByRole('button', { name: /思想碰撞/ }).click()
  await index.getByRole('button', { name: /^TCP \d+%$/ }).click()
  await index.getByRole('button', { name: /^传输层/ }).click()
  await page.getByRole('button', { name: '开始碰撞' }).click()
  await expect(page.getByText('本地模拟创意')).toBeVisible()
  await page.getByRole('button', { name: '保存为创意星球' }).click()
  await expect(page.getByText(/已保存创意星球/)).toBeVisible()
  await page.goto('/tutor?node=n1')
  await page.getByRole('button', { name: '开始复习' }).click()
  await page.getByLabel(/你的答案/).fill('确认收到数据')
  await page.getByRole('button', { name: '提交答案' }).click()
  await expect(page.getByText('本次掌握度变化')).toBeVisible()
  await page.goto('/archive?document=d1&chunk=c1')
  await expect(page.getByText(/TCP 提供面向连接/)).toBeVisible()
  await page.goto('/universe')
  await expect(index.getByRole('button', { name: /跨主题实验/ })).toBeVisible()
  await expect(index.getByRole('button', { name: 'TCP 70%' })).toBeVisible()
  await index.getByRole('button', { name: /^TCP \d+%$/ }).click()
  await expect(page.getByText('确认和重传保证可靠传输。').last()).toBeVisible()
})

test('真实模式区分 401 和模型失败，不回落到模拟响应', async ({ page }) => {
  let requests = 0
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/sessions')) return route.fulfill({ status: 201, json: { sessionToken: 'e2e-session' } })
    if (path.endsWith('/graph') && ++requests === 1) return route.fulfill({ status: 401, json: { error: { code: 'INVALID_SESSION', message: '会话失效' } } })
    if (path.endsWith('/graph')) return route.fulfill({ json: { graphVersion: 0, nodes: [], edges: [] } })
    return route.fulfill({ status: 502, json: { error: { code: 'MODEL_ERROR', message: '模型暂不可用' } } })
  })
  await page.goto('/universe')
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('heading', { name: '宇宙尚无星球' })).toBeVisible()
  await page.getByRole('button', { name: '导入知识' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('粘贴文本').check()
  await dialog.getByLabel(/资料文本/).fill('用于核对错误状态的测试资料。')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '开始导入' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('模型暂不可用')
  await expect(dialog.getByLabel(/资料文本/)).toHaveValue('用于核对错误状态的测试资料。')
})
