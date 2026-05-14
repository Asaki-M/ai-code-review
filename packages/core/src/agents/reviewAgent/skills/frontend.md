---
name: frontend
description: 前端 Code Review 规范，适用于 UI、交互、可访问性、状态管理、前端性能和 XSS 风险。
---

# 前端 Code Review 规范

## UI 与交互
- 检查 loading、empty、error、disabled、success 等状态是否完整。
- 检查表单校验、重复提交、防抖节流、焦点管理和键盘操作。
- 检查响应式布局、长文本、溢出、暗色模式和不同视口下的可用性。

## 可访问性
- 交互元素应具备正确语义、可聚焦状态、aria 标签和键盘可操作性。
- 图片、图标按钮、表单错误提示需要有可理解的替代文本或关联关系。
- 不应只依赖颜色表达状态，文字对比度应满足可读性要求。

## 状态与数据流
- 检查 React/Vue/Svelte 等组件状态是否存在 stale closure、竞态请求、内存泄漏。
- 检查 hook 依赖、computed/memo 缓存、effect 清理和组件卸载后的更新。
- 检查客户端缓存、分页、乐观更新和错误回滚是否一致。

## 性能
- 避免无意义重渲染、过大 bundle、阻塞主线程和重复请求。
- 列表渲染应有稳定 key，大列表应考虑虚拟滚动或分页。
- 图片、字体、第三方脚本和懒加载策略应符合页面性能要求。

## 安全
- 检查 XSS 风险，包括 dangerouslySetInnerHTML、动态 HTML、URL 注入和不可信 markdown。
- 检查敏感信息是否暴露在前端代码、日志、source map 或 localStorage 中。
