# ONES Bug 信息提取工具

这是一个使用 Puppeteer 从 ONES 系统自动提取 Bug 信息的工具。

## 功能特性

- ✅ 自动登录 ONES 系统
- ✅ 遍历 Bug 列表
- ✅ 根据日期过滤 Bug
- ✅ 根据关键字过滤 Bug 标题
- ✅ 提取详细的 Bug 信息（ID、标题、优先级、状态、指派人、创建时间等）
- ✅ 从详情页提取额外信息（Log地址、VIN号、Build版本、问题时间）
- ✅ 导出为 JSON 格式文件

## 安装

1. 确保已安装 Node.js (建议 v16 或更高版本)

2. 安装依赖：
```bash
npm install
```

这将自动安装 Puppeteer 及其依赖的 Chromium 浏览器。

## 使用方法

### 基本用法

```bash
# 提取指定日期的所有 Bug
node extract_bugs.js 2026-05-12

# 提取指定日期且标题包含关键字的 Bug
node extract_bugs.js 2026-05-12 minidump
```

### 参数说明

- **参数1 (必需)**: 日期，格式为 YYYY-MM-DD
  - 示例: `2026-05-12`
  - 只提取创建时间在指定日期（0点到24点）的 Bug

- **参数2 (可选)**: 关键字
  - 示例: `minidump`
  - 只提取标题中包含该关键字的 Bug

### 输出结果

提取的 Bug 信息将保存到 `output` 目录下，文件名为：
```
bugs_YYYY-MM-DD_时间戳.json
```

JSON 文件格式示例：
```json
[
  {
    "id": "BUG-123",
    "title": "系统崩溃问题",
    "priority": "高",
    "status": "进行中",
    "assignee": "张三",
    "created_at": "2026-05-12 10:30:00",
    "log_address": "http://log-server/path/to/log",
    "vin": "LSVAM218XFN123456",
    "build_version": "v2.1.0",
    "issue_time": "2026-05-12 09:15:00"
  }
]
```

## 配置说明

如果需要调整选择器以匹配实际页面结构，请编辑 `extract_bugs.js` 文件中的 `CONFIG.selectors` 部分：

```javascript
const CONFIG = {
    selectors: {
        // 根据实际情况调整这些选择器
        bugListRows: '.table-row, tr[data-key], .issue-item',
        bugId: '.bug-id, .issue-id, [data-field="id"]',
        // ... 其他选择器
    }
};
```

## 注意事项

1. **首次运行**: Puppeteer 会下载 Chromium 浏览器（约 170MB），请耐心等待

2. **页面结构**: 如果 ONES 系统的页面结构发生变化，可能需要调整选择器配置

3. **网络环境**: 确保能够访问 https://ones.autoai.com

4. **账号权限**: 使用的账号需要有查看 Bug 列表和详情的权限

5. **运行模式**: 
   - 当前设置为 `headless: false`，可以看到浏览器操作过程
   - 如需后台运行，改为 `headless: true`

6. **速度控制**: 设置了 `slowMo: 100` 减慢操作速度，可根据需要调整

## 常见问题

### Q: 登录失败怎么办？
A: 检查用户名和密码是否正确，或者页面是否有验证码等额外验证

### Q: 提取不到数据？
A: 可能是页面选择器不匹配，需要打开浏览器开发者工具检查实际的 CSS 选择器

### Q: 运行很慢？
A: 可以调整 `slowMo` 参数，或设置 `headless: true` 提高速度

### Q: 如何只提取特定状态的 Bug？
A: 可以在 `checkBugFilter` 函数中添加额外的过滤条件

## 许可证

ISC
