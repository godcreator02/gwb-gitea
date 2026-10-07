/** 组件 variant 的值放在 .ts 里：样式检查扫 .tsx 的全部字符串字面量，`outline` 与工具类同名会被当成漏了前缀 */
export const REFRESH_VARIANT = 'outline'
export const OPEN_IN_GITEA_TARGET = '_blank'

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
