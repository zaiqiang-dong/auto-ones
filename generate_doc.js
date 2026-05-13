const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 执行命令并获取输出
 */
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
 * 生成飞书文档内容
 */
function generateFeishuDocContent(bugs, processedBugsDir) {
    console.log('\n========== 生成飞书文档内容 ==========');
    
    let docContent = '# Bug 分析报告\n\n';
    docContent += `**生成时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;
    docContent += `**Bug 总数**: ${bugs.length}\n\n`;
    docContent += '---\n\n';
    
    bugs.forEach((bug, index) => {
        console.log(`处理第 ${index + 1}/${bugs.length} 个 Bug: ${bug.id}`);
        
        // Bug 基本信息
        docContent += `## ${index + 1}. ${bug.id}\n\n`;
        docContent += `**标题**: ${bug.title}\n\n`;
        docContent += `**创建时间**: ${bug.createTime}\n\n`;
        docContent += `**状态**: ${bug.status || '未知'}\n\n`;
        docContent += `**优先级**: ${bug.priority || '未知'}\n\n`;
        
        // Bug 描述
        if (bug.description) {
            docContent += `**描述**:\n\n${bug.description}\n\n`;
        }
        
        // Log 地址
        if (bug.logUrl) {
            docContent += `**Log 地址**: ${bug.logUrl}\n\n`;
        }
        
        // 查找对应的 UefiLog 文件
        const bugId = bug.id;
        const dateStr = bug.createTime ? bug.createTime.split(' ')[0] : '';
        const bugDir = path.join(processedBugsDir, dateStr, bugId);
        
        console.log(`  → 查找目录: ${bugDir}`);
        
        const uefiLogs = findUefiLogs(bugDir);
        
        if (uefiLogs.length > 0) {
            docContent += `### UEFI Log 分析\n\n`;
            
            uefiLogs.forEach((log, logIndex) => {
                docContent += `#### ${log.filename}\n\n`;
                docContent += '```\n';
                docContent += log.content;
                docContent += '\n```\n\n';
            });
        } else {
            docContent += `### UEFI Log 分析\n\n`;
            docContent += `*未找到 UEFI Log 文件*\n\n`;
        }
        
        docContent += '---\n\n';
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
    console.log('  Bug 分析与飞书文档生成工具');
    console.log('========================================\n');
    
    // 获取命令行参数（与 extract_bugs.js 相同）
    const args = process.argv.slice(2);
    const dateParam = args[0] || '2026-05-12';
    const keyword = args[1] || '';
    const projectName = args[2] || '';
    
    console.log(`参数:`);
    console.log(`  日期: ${dateParam}`);
    console.log(`  关键字: ${keyword || '无'}`);
    console.log(`  项目名: ${projectName || '无'}\n`);
    
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
    const jsonFile = findLatestBugJson();
    console.log(`\n✓ 找到 Bug JSON 文件: ${jsonFile.name}`);
    
    // 步骤 2.5: 先读取 Bug 数据（在调用 process_bugs.js 之前）
    console.log('\n========== 步骤 2.5: 预读取 Bug 数据 ==========');
    const bugs = readBugJson(jsonFile.path);
    console.log(`✓ 读取到 ${bugs.length} 个 Bug`);
    
    // 步骤 2: 调用 process_bugs.js 解析 Dump
    console.log('\n========== 步骤 2: 解析 Dump 文件 ==========');
    const processCmd = `node process_bugs.js ${jsonFile.path}`;
    const processSuccess = runCommand(processCmd);
    if (!processSuccess) {
        console.error('✗ Dump 解析失败，但仍继续生成文档');
    }
    
    // 步骤 3: 使用已读取的 Bug 数据
    console.log('\n========== 步骤 3: 准备生成文档 ==========');
    
    // 步骤 4: 生成文档
    console.log('\n========== 步骤 4: 生成文档 ==========');
    const processedBugsDir = path.join(__dirname, 'processed_bugs');
    const docContent = generateFeishuDocContent(bugs, processedBugsDir);
    
    // 保存文档
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
