// 静态资源模块声明（Vite 会解析为 URL 字符串）
declare module '*.png' {
  const url: string
  export default url
}
declare module '*.jpg' {
  const url: string
  export default url
}
declare module '*.jpeg' {
  const url: string
  export default url
}
declare module '*.svg' {
  const url: string
  export default url
}
