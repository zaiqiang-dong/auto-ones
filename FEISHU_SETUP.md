# 飞书文档集成使用说明

## 📋 配置步骤

### 1. 获取飞书应用凭证

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取以下信息：
   - **App ID** (应用 ID)
   - **App Secret** (应用密钥)

### 2. 配置权限

在飞书开放平台的应用管理中，确保启用以下权限：

- `docx:document` - 云文档读写权限
- `docx:document:readonly` - 云文档只读权限（可选）

### 3. 编辑配置文件

打开 `feishu_config.json` 文件，填入您的凭证：

```json
{
    "appId": "your_app_id_here",
    "appSecret": "your_app_secret_here",
    "folderToken": ""  // 可选：指定文件夹 token
}
```

**注意**: 此文件已添加到 `.gitignore`，不会被提交到 Git。

### 4. （可选）指定文件夹

如果要将文档创建到特定文件夹：

1. 打开飞书云文档
2. 进入目标文件夹
3. 从 URL 中获取 folder_token
   - URL 格式: `https://autoai.feishu.cn/drive/folder/{folder_token}`
4. 将 token 填入 `feishu_config.json` 的 `folderToken` 字段

## 🚀 使用方法

### 基本用法（生成 Markdown 文件）

```bash
node generate_doc.js 2026-05-11 "minidump" ""
```

### 调试模式（跳过提取和解析）

```bash
node generate_doc.js 2026-05-11 "minidump" "" --debug
```

### 创建飞书文档

```bash
node generate_doc.js 2026-05-11 "minidump" "" --feishu
```

或简写：

```bash
node generate_doc.js 2026-05-11 "minidump" "" -f
```

### 调试模式 + 飞书文档

```bash
node generate_doc.js 2026-05-11 "minidump" "" --debug --feishu
```

## 📝 输出说明

### Markdown 模式
- 生成文件: `output/doc_2026-05-11.md`
- 可以手动复制到飞书文档

### 飞书文档模式
- 自动创建云文档
- 返回文档链接，例如: `https://autoai.feishu.cn/docx/xxxxx`
- 如果创建失败，会自动降级为 Markdown 文件

## ⚠️ 注意事项

1. **安全性**: 不要将 `feishu_config.json` 分享给他人
2. **权限**: 确保应用有足够的文档创建权限
3. **网络**: 需要能够访问飞书开放平台 API
4. **格式**: 当前使用简化版 Markdown 转换，复杂格式可能需要手动调整

## 🔧 故障排除

### 获取令牌失败
- 检查 App ID 和 App Secret 是否正确
- 确认应用已发布并启用

### 创建文档失败
- 检查是否有 docx 权限
- 确认 folderToken 是否有效（如果设置了）

### 内容写入失败
- 脚本会自动尝试备用方式（代码块形式）
- 查看控制台输出的错误信息

## 📞 支持

如有问题，请检查：
1. 飞书开放平台应用状态
2. 权限配置
3. 网络连接
4. 控制台错误日志
