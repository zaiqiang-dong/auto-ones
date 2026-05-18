# ONES Bug 信息提取工具

这是一个使用 Puppeteer 从 ONES 系统自动提取 Bug 信息的工具。

## 功能特性

### extract_smart.js - Bug 信息提取
- ✅ 自动登录 ONES 系统
- ✅ 遍历 Bug 列表
- ✅ 根据日期过滤 Bug
- ✅ 根据关键字过滤 Bug 标题
- ✅ 根据项目名过滤 Bug 标题
- ✅ 提取详细的 Bug 信息（ID、标题、优先级、状态、指派人、创建时间等）
- ✅ 从详情页提取额外信息（Log地址、VIN号、Build版本、编译类型、问题时间）
- ✅ 导出为 JSON 格式文件

### process_bugs.js - Bug 文件处理
- ✅ 自动创建日期目录结构
- ✅ 为每个 Bug 创建独立目录
- ✅ 下载 Log 文件
- ✅ 自动进行 Dump 解析（访问 http://172.25.32.27:8088/）
- ✅ 自动选择项目、上传文件、填写版本
- ✅ 等待解析完成并下载结果
- ✅ 解析并保存分析结果

## 安装

1. 确保已安装 Node.js (建议 v16 或更高版本)

2. 安装依赖：
```bash
npm install
```

这将自动安装 Puppeteer 及其依赖的 Chromium 浏览器。

## 使用方法

### 提取 Bug 信息

```bash
# 提取指定日期的所有 Bug
node extract_smart.js 2026-05-12

# 提取指定日期且标题包含关键字的 Bug
node extract_smart.js 2026-05-12 minidump

# 提取指定日期、匹配项目名且标题包含关键字的 Bug
node extract_smart.js 2026-05-12 minidump 五菱F710S
```

### 处理 Bug 文件（下载 Log 并解析 Dump）

```bash
# 处理提取的 JSON 文件
node process_bugs.js extract_bugs/2026-05-12.json
```

该脚本会：
1. 根据 Bug 创建时间创建日期目录
2. 为每个 Bug 创建以 ID 命名的子目录
3. 下载 Log 文件到对应目录
4. 自动访问 Dump 分析器进行解析
5. 下载解析结果并保存

### 生成飞书文档

脚本会根据日期读取 `extract_bugs/YYYY-MM-DD.json`，把 Bug 信息整理为 Markdown，然后通过 `lark-cli docs +create --as user` 创建飞书文档。

```bash
# 生成飞书文档
node create_lark_doc.js 2026-05-17

# 自定义标题
node create_lark_doc.js 2026-05-17 --title "2026-05-17 Bug 汇总"

# 仅预览 Markdown，不创建文档
node create_lark_doc.js 2026-05-17 --dry-run
```

### 参数说明

- **参数1 (必需)**: 日期，格式为 YYYY-MM-DD
  - 示例: `2026-05-12`
  - 只提取创建时间在指定日期（0点到24点）的 Bug

- **参数2 (可选)**: 关键字
  - 示例: `minidump`
  - 只提取标题中包含该关键字的 Bug

- **参数3 (可选)**: 项目名
  - 示例: `五菱F710S`
  - 先按项目名过滤，再按关键字过滤
  - 如果同时提供参数2和参数3，Bug 标题需要同时包含项目名和关键字

### 输出结果

提取的 Bug 信息将保存到 `extract_bugs` 目录下，文件名为：
```
YYYY-MM-DD.json
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
   - `process_bugs.js` 默认使用静默无头模式，不会打开可见浏览器窗口或抢占桌面焦点
   - 如需临时查看浏览器操作过程，可使用 `PROCESS_BUGS_HEADFUL=1 node process_bugs.js <json文件路径>`

6. **速度控制**: `process_bugs.js` 在静默模式下不启用 `slowMo`；可视调试模式下会减慢操作，便于观察页面行为

## 常见问题

### Q: 登录失败怎么办？
A: 检查用户名和密码是否正确，或者页面是否有验证码等额外验证

### Q: 提取不到数据？
A: 可能是页面选择器不匹配，需要打开浏览器开发者工具检查实际的 CSS 选择器

### Q: 运行很慢？
A: `process_bugs.js` 默认已使用无头模式；如仍然较慢，通常是下载、上传或 Dump 分析器处理耗时

### Q: 如何只提取特定状态的 Bug？
A: 可以在 `checkBugFilter` 函数中添加额外的过滤条件

## 许可证

ISC
