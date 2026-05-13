const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 飞书配置
let FEISHU_CONFIG = {
    appId: '',
    appSecret: '',
    folderToken: '',
};

// 尝试从配置文件加载
const configPath = path.join(__dirname, 'feishu_config.json');
if (fs.existsSync(configPath)) {
    try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        FEISHU_CONFIG = { ...FEISHU_CONFIG, ...configData };
        console.log('✓ 已加载飞书配置文件');
    } catch (error) {
        console.log('⚠ 加载飞书配置文件失败，使用默认配置');
    }
}

/**
 * 获取飞书访问令牌
 */
async function getFeishuAccessToken() {
    console.log('→ 获取飞书访问令牌...');
    try {
        const response = await axios.post(
            'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            {
                app_id: FEISHU_CONFIG.appId,
                app_secret: FEISHU_CONFIG.appSecret
            }
        );
        
        if (response.data.code === 0) {
            console.log('✓ 获取访问令牌成功');
            return response.data.tenant_access_token;
        } else {
            throw new Error(`获取令牌失败: ${response.data.msg}`);
        }
    } catch (error) {
        console.error('✗ 获取访问令牌失败:', error.message);
        throw error;
    }
}

/**
 * 创建飞书云文档
 */
async function createFeishuDoc(accessToken, title, content) {
    console.log('→ 创建飞书云文档...');
    try {
        // 第一步：创建空文档
        const createResponse = await axios.post(
            'https://open.feishu.cn/open-apis/docx/v1/documents',
            {
                title: title,
                folder_token: FEISHU_CONFIG.folderToken || undefined
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (createResponse.data.code !== 0) {
            throw new Error(`创建文档失败: ${createResponse.data.msg} (code: ${createResponse.data.code})`);
        }
        
        const documentId = createResponse.data.data.document.document_id;
        console.log(`✓ 文档创建成功，ID: ${documentId}`);
        
        // 第二步：将 Markdown 内容转换为富文本并写入文档
        console.log('→ 写入文档内容...');
        try {
            await writeContentToFeishuDoc(accessToken, documentId, content);
        } catch (writeError) {
            console.log('⚠ 内容自动写入失败，但文档已创建');
            console.log('  您可以手动将 Markdown 文件内容复制到飞书文档中');
            // 不抛出错误，继续返回文档信息
        }
        
        // 返回文档链接
        const docUrl = `https://autoai.feishu.cn/docx/${documentId}`;
        console.log(`✓ 文档链接: ${docUrl}`);
        
        return {
            documentId,
            url: docUrl
        };
    } catch (error) {
        if (error.response) {
            // 服务器返回了错误响应
            console.error('✗ 创建飞书文档失败:', error.message);
            console.error('  状态码:', error.response.status);
            console.error('  响应数据:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('✗ 创建飞书文档失败:', error.message);
        }
        throw error;
    }
}

/**
 * 将 Markdown 内容写入飞书文档
 * 注意：这里使用简单的方式，将 Markdown 作为纯文本写入
 * 如果需要更好的格式，需要使用飞书的富文本 API
 */
async function writeContentToFeishuDoc(accessToken, documentId, markdownContent) {
    try {
        // 将 Markdown 转换为简单的富文本块
        const blocks = convertMarkdownToBlocks(markdownContent);
        
        await axios.patch(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/batch_create`,
            {
                children: blocks
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✓ 内容写入成功');
    } catch (error) {
        console.error('✗ 写入内容失败:', error.message);
        // 如果批量写入失败，尝试使用简单方式
        console.log('→ 尝试使用备用方式写入...');
        await simpleWriteToFeishuDoc(accessToken, documentId, markdownContent);
    }
}

/**
 * 将文本中的 **text** 转换为飞书的富文本元素
 */
function parseBoldText(text) {
    const elements = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        // 添加粗体前的普通文本
        if (match.index > lastIndex) {
            elements.push({
                text_run: {
                    content: text.substring(lastIndex, match.index)
                }
            });
        }
        
        // 添加粗体文本
        elements.push({
            text_run: {
                content: match[1],
                text_element_style: {
                    bold: true
                }
            }
        });
        
        lastIndex = regex.lastIndex;
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
        elements.push({
            text_run: {
                content: text.substring(lastIndex)
            }
        });
    }
    
    return elements.length > 0 ? elements : [{ text_run: { content: text } }];
}

/**
 * 简单的写入方式：使用飞书的 blocks/children API
 */
async function simpleWriteToFeishuDoc(accessToken, documentId, markdownContent) {
    try {
        console.log('→ 尝试使用 blocks/children API 写入...');
        
        // 第一步：获取文档信息，找到 root block
        console.log('  → 获取文档信息...');
        const docInfo = await axios.get(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        if (docInfo.data.code !== 0) {
            throw new Error(`获取文档信息失败: ${docInfo.data.msg}`);
        }
        
        // 第二步：获取文档的所有 blocks，找到第一个 block 作为 parent
        console.log('  → 获取文档 blocks...');
        const blocksResponse = await axios.get(
            `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    page_size: 1
                }
            }
        );
        
        if (blocksResponse.data.code !== 0) {
            throw new Error(`获取 Blocks 失败: ${blocksResponse.data.msg}`);
        }
        
        const blocks = blocksResponse.data.data.items;
        
        // 如果文档为空，使用文档 ID 作为 parent block
        let parentBlockId;
        if (!blocks || blocks.length === 0) {
            console.log('  → 文档为空，使用文档 ID 作为 Parent Block');
            parentBlockId = documentId;
        } else {
            parentBlockId = blocks[0].block_id;
            console.log(`  → Parent Block ID: ${parentBlockId}`);
        }
        
        // 第三步：将 Markdown 按段落分割
        const paragraphs = markdownContent.split('\n\n').filter(p => p.trim() !== '');
        console.log(`→ 准备写入 ${paragraphs.length} 个段落...`);
        
        // 第四步：逐个段落写入
        for (let i = 0; i < paragraphs.length; i++) {
            const paragraph = paragraphs[i];
            const lines = paragraph.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length === 0) continue;
            
            // 构建 block
            let block;
            if (lines[0].startsWith('# ')) {
                block = {
                    block_type: 3,
                    heading1: {
                        elements: [{
                            text_run: { content: lines[0].substring(2).trim() }
                        }]
                    }
                };
            } else if (lines[0].startsWith('## ')) {
                block = {
                    block_type: 4,
                    heading2: {
                        elements: [{
                            text_run: { content: lines[0].substring(3).trim() }
                        }]
                    }
                };
            } else if (lines[0].startsWith('### ')) {
                block = {
                    block_type: 5,
                    heading3: {
                        elements: [{
                            text_run: { content: lines[0].substring(4).trim() }
                        }]
                    }
                };
            } else if (lines[0].startsWith('---')) {
                // 分隔线 - 需要 divider 字段
                block = {
                    block_type: 22,
                    divider: {}
                };
            } else {
                const content = lines.join('\n');
                // 解析粗体标记，转换为富文本元素
                const elements = parseBoldText(content);
                block = {
                    block_type: 2,
                    text: {
                        elements: elements
                    }
                };
            }
            
            // 使用 POST /blocks/{block_id}/children API 添加子块
            const requestBody = {
                children: [block],
                index: i  // 从 0 开始插入
            };
            
            console.log(`  → 写入段落 ${i + 1}, block_type: ${block.block_type}`);
            if (i === 0) {
                console.log('  → 第一个 Block 结构:', JSON.stringify(block, null, 2).substring(0, 300));
            }
            
            await axios.post(
                `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
                requestBody,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            if ((i + 1) % 10 === 0 || i === paragraphs.length - 1) {
                console.log(`  → 已写入 ${i + 1}/${paragraphs.length} 个段落`);
            }
            
            // 避免频率限制，每个请求后暂停 400ms (每秒最多 2-3 次)
            await new Promise(resolve => setTimeout(resolve, 400));
        }
        
        console.log('✓ 内容写入成功');
        return true;
        
    } catch (error) {
        console.error('✗ 写入内容失败:', error.message);
        if (error.response) {
            console.error('  状态码:', error.response.status);
            console.error('  响应数据:', JSON.stringify(error.response.data, null, 2).substring(0, 500));
        }
        throw error;
    }
}

/**
 * 将 Markdown 转换为飞书富文本块（简化版）
 */
function convertMarkdownToBlocks(markdown) {
    const lines = markdown.split('\n');
    const blocks = [];
    let currentParagraph = [];
    
    for (const line of lines) {
        // 标题
        if (line.startsWith('# ')) {
            if (currentParagraph.length > 0) {
                blocks.push(createParagraphBlock(currentParagraph.join('\n')));
                currentParagraph = [];
            }
            blocks.push(createHeadingBlock(line.substring(2), 1));
        } else if (line.startsWith('## ')) {
            if (currentParagraph.length > 0) {
                blocks.push(createParagraphBlock(currentParagraph.join('\n')));
                currentParagraph = [];
            }
            blocks.push(createHeadingBlock(line.substring(3), 2));
        } else if (line.startsWith('### ')) {
            if (currentParagraph.length > 0) {
                blocks.push(createParagraphBlock(currentParagraph.join('\n')));
                currentParagraph = [];
            }
            blocks.push(createHeadingBlock(line.substring(4), 3));
        } else if (line.trim() === '') {
            // 空行，结束当前段落
            if (currentParagraph.length > 0) {
                blocks.push(createParagraphBlock(currentParagraph.join('\n')));
                currentParagraph = [];
            }
        } else if (line.startsWith('---')) {
            // 分隔线
            if (currentParagraph.length > 0) {
                blocks.push(createParagraphBlock(currentParagraph.join('\n')));
                currentParagraph = [];
            }
            blocks.push(createDividerBlock());
        } else {
            currentParagraph.push(line);
        }
    }
    
    // 处理最后的段落
    if (currentParagraph.length > 0) {
        blocks.push(createParagraphBlock(currentParagraph.join('\n')));
    }
    
    return blocks;
}

function createHeadingBlock(text, level) {
    return {
        block_type: 3,  // Heading
        heading: {
            level: level,
            elements: [
                {
                    text_run: {
                        content: text,
                        text_element_style: {
                            bold: true
                        }
                    }
                }
            ]
        }
    };
}

function createParagraphBlock(text) {
    return {
        block_type: 2,  // Text
        text: {
            elements: [
                {
                    text_run: {
                        content: text
                    }
                }
            ]
        }
    };
}

function createDividerBlock() {
    return {
        block_type: 22  // Divider
    };
}
function runCommand(command) {
    console.log(`\n→ 执行命令: ${command}`);
    try {
        execSync(command, { stdio: 'inherit' });
        return true;
    } catch (error) {
        console.error(`✗ 命令执行失败: ${error.message}`);
        return false;
    }
}

/**
 * 查找最新的 Bug JSON 文件
 */
function findLatestBugJson() {
    const outputDir = path.join(__dirname, 'extract_bugs');
    
    if (!fs.existsSync(outputDir)) {
        throw new Error('extract_bugs 目录不存在，请先运行 extract_bugs.js');
    }
    
    const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('bugs_') && f.endsWith('.json'))
        .map(f => ({
            name: f,
            path: path.join(outputDir, f),
            time: fs.statSync(path.join(outputDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // 按时间倒序
    
    if (files.length === 0) {
        throw new Error('未找到 Bug JSON 文件');
    }
    
    return files[0];
}

/**
 * 读取 Bug JSON 文件
 */
function readBugJson(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}

/**
 * 从 processed_bugs 目录中查找 UefiLog*.txt 文件
 */
function findUefiLogs(bugDir) {
    if (!fs.existsSync(bugDir)) {
        return [];
    }
    
    const files = fs.readdirSync(bugDir);
    const uefiLogs = files.filter(f => 
        f.toLowerCase().includes('uefilog') && f.toLowerCase().endsWith('.txt')
    );
    
    return uefiLogs.map(f => ({
        filename: f,
        filepath: path.join(bugDir, f),
        content: fs.readFileSync(path.join(bugDir, f), 'utf-8')
    }));
}

/**
 * 生成文档内容（包含所有 Bug 字段）
 */
function generateDocContent(bugs, processedBugsDir) {
    console.log('\n========== 生成文档内容 ==========');
    
    let docContent = '# Bug 分析报告\n';
    docContent += `**生成时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    docContent += `**Bug 总数**: ${bugs.length}\n`;
    docContent += '---\n';
    
    bugs.forEach((bug, index) => {
        console.log(`处理第 ${index + 1}/${bugs.length} 个 Bug: ${bug.id}`);
        
        // Bug ID 作为标题
        docContent += `## ${index + 1}. ${bug.id}\n`;
        
        // 遍历 Bug 对象的所有字段
        for (const [key, value] of Object.entries(bug)) {
            // 跳过一些不需要显示的字段
            if (['rowIndex'].includes(key)) {
                continue;
            }
            
            // 格式化字段名（中文显示）
            const fieldNames = {
                'id': 'Bug ID',
                'title': '标题',
                'created_at': '创建时间',
                'vin': 'VIN号',
                'build_version': 'Build版本',
                'compile_type': '编译类型',
                'log_address': 'Log地址',
                'issue_time': '问题时间',
                'status': '状态',
                'priority': '优先级',
                'assignee': '指派人',
                'description': '描述',
                'bug_url': 'Bug地址'
            };
            
            const fieldName = fieldNames[key] || key;
            
            // 根据值的类型进行不同的显示
            if (value === null || value === undefined || value === '') {
                docContent += `**${fieldName}**: 未填写\n`;
            } else if (key === 'bug_url' && typeof value === 'string' && value.startsWith('http')) {
                // Bug地址显示为可点击的链接
                docContent += `**${fieldName}**: [${value}](${value})\n`;
            } else if (typeof value === 'object') {
                docContent += `**${fieldName}**:\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
            } else {
                docContent += `**${fieldName}**: ${value}\n`;
            }
        }
        
        docContent += '---\n';
    });
    
    return docContent;
}

/**
 * 保存文档
 */
function saveDoc(content, dateParam) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, `doc_${dateParam}.md`);
    
    fs.writeFileSync(outputFile, content, 'utf-8');
    
    console.log(`\n✓ 文档已保存到: ${outputFile}`);
    return outputFile;
}

/**
 * 主函数
 */
async function main() {
    console.log('========================================');
    console.log('  Bug 分析与文档生成工具');
    console.log('========================================\n');
    
    // 获取命令行参数
    const args = process.argv.slice(2);
    const dateParam = args[0] || '2026-05-12';
    const keyword = args[1] || '';
    const projectName = args[2] || '';
    const debugMode = args.includes('--debug') || args.includes('-d');
    // 默认输出 Markdown 文件
    const useFeishu = false;
    
    console.log(`参数:`);
    console.log(`  日期: ${dateParam}`);
    console.log(`  关键字: ${keyword || '无'}`);
    console.log(`  项目名: ${projectName || '无'}`);
    console.log(`  调试模式: ${debugMode ? '是（跳过提取和解析）' : '否'}`);
    console.log(`  输出格式: Markdown\n`);
    
    let jsonFile;
    let bugs;
    
    if (debugMode) {
        // 调试模式：直接使用已有的 JSON 文件
        console.log('========== 调试模式：使用已有数据 ==========');
        jsonFile = findLatestBugJson();
        console.log(`✓ 找到 Bug JSON 文件: ${jsonFile.name}`);
        
        console.log('\n========== 读取 Bug 数据 ==========');
        bugs = readBugJson(jsonFile.path);
        console.log(`✓ 读取到 ${bugs.length} 个 Bug`);
    } else {
        // 正常模式：执行完整流程
        // 步骤 1: 调用 extract_bugs.js 生成 Bug JSON 文件
        console.log('========== 步骤 1: 提取 Bug 信息 ==========');
        let extractCmd = `node extract_bugs.js ${dateParam}`;
        if (keyword) {
            extractCmd += ` "${keyword}"`;
        }
        if (projectName) {
            extractCmd += ` "${projectName}"`;
        }
        
        const extractSuccess = runCommand(extractCmd);
        if (!extractSuccess) {
            console.error('✗ Bug 提取失败，终止执行');
            process.exit(1);
        }
        
        // 查找生成的 JSON 文件
        jsonFile = findLatestBugJson();
        console.log(`\n✓ 找到 Bug JSON 文件: ${jsonFile.name}`);
        
        // 步骤 2.5: 先读取 Bug 数据（在调用 process_bugs.js 之前）
        console.log('\n========== 步骤 2.5: 预读取 Bug 数据 ==========');
        bugs = readBugJson(jsonFile.path);
        console.log(`✓ 读取到 ${bugs.length} 个 Bug`);
        
        // 步骤 2: 调用 process_bugs.js 解析 Dump
        console.log('\n========== 步骤 2: 解析 Dump 文件 ==========');
        const processCmd = `node process_bugs.js ${jsonFile.path}`;
        const processSuccess = runCommand(processCmd);
        if (!processSuccess) {
            console.error('✗ Dump 解析失败，但仍继续生成文档');
        }
        
        console.log('\n========== 步骤 3: 准备生成文档 ==========');
    }
    
    // 步骤 4: 生成文档内容
    console.log('\n========== 步骤 4: 生成文档 ==========');
    const processedBugsDir = path.join(__dirname, 'processed_bugs');
    const docContent = generateDocContent(bugs, processedBugsDir);
    
    // 保存为 Markdown 文件
    const outputFile = saveDoc(docContent, dateParam);
    
    console.log('\n========================================');
    console.log('  ✓ 所有步骤完成！');
    console.log('========================================');
    console.log(`\n输出文件:`);
    console.log(`  Bug JSON: ${jsonFile.path}`);
    console.log(`  文档: ${outputFile}`);
    console.log(`\n提示: 可以将 Markdown 文件内容复制到飞书文档中`);
}

main().catch(error => {
    console.error('\n✗ 发生错误:', error.message);
    console.error(error.stack);
    process.exit(1);
});
