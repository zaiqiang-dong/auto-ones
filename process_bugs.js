const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const AdmZip = require('adm-zip'); // 用于解压 zip 文件

// 配置
const CONFIG = {
    dumpAnalyzerUrl: 'http://172.25.32.27:8088/',
    // 项目名映射：JSON中的项目名 -> 分析器中的项目名
    projectMapping: {
        '奇瑞T16A': 'T16A',
        '五菱F710S': 'F710S',
        // 添加更多映射...
    }
};

/**
 * 从 Bug 标题中提取项目名
 */
function extractProjectFromTitle(title) {
    const match = title.match(/\[(.*?)\]/);
    return match ? match[1] : '';
}

/**
 * 获取映射后的项目名
 */
function getMappedProject(projectName) {
    return CONFIG.projectMapping[projectName] || projectName;
}

/**
 * 下载文件
 */
async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const file = fs.createWriteStream(destPath);
        
        protocol.get(url, (response) => {
            // 处理重定向
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                console.log(`    → 重定向到: ${redirectUrl}`);
                downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
                return;
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`下载失败，状态码: ${response.statusCode}`));
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log(`    ✓ 下载完成: ${destPath}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {}); // 删除不完整的文件
            reject(err);
        });
    });
}

/**
 * 解析单个 Bug
 */
async function processBug(bug, baseDir, browser) {
    const bugId = bug.id;
    const bugDir = path.join(baseDir, bugId);
    
    console.log(`\n处理 Bug: ${bugId}`);
    console.log(`  标题: ${bug.title}`);
    console.log(`  创建时间: ${bug.created_at}`);
    
    // 创建 Bug 目录
    if (!fs.existsSync(bugDir)) {
        fs.mkdirSync(bugDir, { recursive: true });
    }
    
    // 步骤3: 下载 Log 文件
    let logFilePath = null;
    if (bug.log_address) {
        const logFileName = `log_${bugId}.zip`;
        logFilePath = path.join(bugDir, logFileName);
        
        try {
            console.log(`  → 下载 Log 文件...`);
            await downloadFile(bug.log_address, logFilePath);
        } catch (error) {
            console.log(`  ✗ Log 文件下载失败: ${error.message}`);
            logFilePath = null;
        }
    } else {
        console.log(`  ⚠ 没有 Log 地址，跳过下载`);
    }
    
    // 步骤4-7: 使用 Puppeteer 进行 Dump 解析
    if (logFilePath && fs.existsSync(logFilePath)) {
        try {
            console.log(`  → 开始 Dump 解析...`);
            await analyzeDump(bug, bugDir, logFilePath, browser);
        } catch (error) {
            console.log(`  ✗ Dump 解析失败: ${error.message}`);
        }
    } else {
        console.log(`  ⚠ 没有 Log 文件，跳过 Dump 解析`);
    }
    
    // 步骤8: 无论解析成功与否，都解压缩目录下的 zip 文件
    await extractZipFiles(bugDir, bugId);
}

/**
 * 使用浏览器进行 Dump 解析
 */
async function analyzeDump(bug, bugDir, logFilePath, browser) {
    const page = await browser.newPage();
    
    try {
        // 设置下载路径
        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: bugDir
        });
        
        // 监听并自动处理浏览器原生对话框（alert/confirm/prompt）
        let dialogDetected = false;
        page.on('dialog', async (dialog) => {
            console.log(`    → 检测到对话框: ${dialog.type()}, 消息: ${dialog.message()}`);
            await dialog.accept(); // 自动点击确定
            console.log(`    ✓ 已关闭对话框`);
            dialogDetected = true; // 标记已检测到对话框
        });
        
        console.log(`    → 打开 Dump 分析器...`);
        await page.goto(CONFIG.dumpAnalyzerUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // 等待页面加载
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 步骤4.1: 选择项目
        const projectName = extractProjectFromTitle(bug.title);
        const mappedProject = getMappedProject(projectName);
        console.log(`    → 选择项目: ${mappedProject}`);
        
        // 查找项目选择器并选择
        await page.evaluate((project) => {
            // 尝试找到项目选择下拉框
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
                const options = Array.from(select.options);
                for (const option of options) {
                    if (option.text.includes(project) || option.value.includes(project)) {
                        select.value = option.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        }, mappedProject);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 步骤4.2: 选择 dump 类型为 minidump
        console.log(`    → 选择 Dump 类型: minidump`);
        await page.evaluate(() => {
            // 查找 dump 类型选择器
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
                const options = Array.from(select.options);
                for (const option of options) {
                    if (option.text.toLowerCase().includes('minidump') || 
                        option.value.toLowerCase().includes('minidump')) {
                        select.value = option.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 步骤4.3: 上传 Log 文件
        console.log(`    → 上传 Log 文件...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.uploadFile(logFilePath);
            console.log(`    ✓ 文件上传成功`);
        } else {
            throw new Error('未找到文件上传输入框');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 步骤4.4: 填写软件版本
        console.log(`    → 填写软件版本: ${bug.build_version}`);
        await page.evaluate((version) => {
            // 查找版本输入框
            const inputs = Array.from(document.querySelectorAll('input'));
            for (const input of inputs) {
                const placeholder = (input.placeholder || '').toLowerCase();
                const name = (input.name || '').toLowerCase();
                const id = (input.id || '').toLowerCase();
                
                if (placeholder.includes('版本') || placeholder.includes('version') ||
                    name.includes('version') || id.includes('version')) {
                    input.value = version;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, bug.build_version);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 步骤4.5: 点击"解析dump"按钮
        console.log(`    → 点击解析按钮...`);
        const parseButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const button of buttons) {
                const text = button.textContent.trim();
                if (text.includes('解析') || text.includes('Parse') || text.includes('分析')) {
                    return button;
                }
            }
            return null;
        });
        
        if (parseButton) {
            await parseButton.click();
            console.log(`    ✓ 已点击解析按钮`);
        } else {
            throw new Error('未找到解析按钮');
        }
        
        // 步骤4.6: 等待解析完成
        console.log(`    → 等待解析完成...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 初始等待
        
        // 轮询检查是否弹出确认消息或"下载解析结果"按钮
        let maxWait = 60000; // 最多等待60秒
        let waited = 0;
        const checkInterval = 2000;
        let parseSuccess = false;
        
        while (waited < maxWait) {
            // 如果检测到对话框（通过 page.on('dialog')），直接跳出
            if (dialogDetected) {
                console.log(`    ⚠ 解析过程中出现错误对话框`);
                break;
            }
            
            const result = await page.evaluate(() => {
                // 检查是否有确认弹窗（对话框）- 使用多种检测方法
                // 方法1: 查找常见的模态框类名
                const modalSelectors = [
                    '.modal', '.dialog', '[role="dialog"]',
                    '.ant-modal', '.el-dialog', '.v-modal',
                    '.ones-modal', '.modal-content',
                    '[class*="modal"]', '[class*="dialog"]'
                ];
                
                for (const selector of modalSelectors) {
                    try {
                        const modals = document.querySelectorAll(selector);
                        for (const modal of modals) {
                            // 检查是否可见
                            const style = window.getComputedStyle(modal);
                            if (style.display !== 'none' && 
                                style.visibility !== 'hidden' && 
                                parseFloat(style.opacity) > 0) {
                                console.log('找到模态框:', selector, modal.className);
                                return { type: 'dialog', found: true };
                            }
                        }
                    } catch (e) {
                        // 忽略无效选择器
                    }
                }
                
                // 方法2: 查找所有包含"确定"、"确认"、"OK"文本的按钮（可能在弹窗中）
                const allButtons = Array.from(document.querySelectorAll('button'));
                for (const btn of allButtons) {
                    const text = btn.textContent.trim();
                    if (text === '确定' || text === '确认' || text === 'OK' || text === '关闭') {
                        console.log('找到确认按钮:', text);
                        // 检查这个按钮是否在可见的容器中
                        let parent = btn.parentElement;
                        while (parent) {
                            const style = window.getComputedStyle(parent);
                            if (style.display !== 'none' && style.visibility !== 'hidden') {
                                // 如果父元素有模态框特征
                                if (parent.classList.contains('modal') || 
                                    parent.classList.contains('dialog') ||
                                    parent.getAttribute('role') === 'dialog' ||
                                    style.position === 'fixed' ||
                                    style.zIndex > 1000) {
                                    console.log('按钮在模态框中');
                                    return { type: 'dialog', found: true };
                                }
                            }
                            parent = parent.parentElement;
                        }
                    }
                }
                
                // 检查是否有"下载解析结果"按钮
                for (const button of allButtons) {
                    const text = button.textContent.trim();
                    if ((text.includes('下载') || text.includes('Download')) && 
                        (text.includes('结果') || text.includes('Result')) &&
                        !button.disabled) {
                        console.log('找到下载按钮:', text);
                        return { type: 'success', button: button };
                    }
                }
                
                return { type: 'waiting' };
            });
            
            if (result.type === 'dialog') {
                console.log(`    → 检测到确认弹窗，点击确认...`);
                // 点击对话框中的确认按钮
                await page.evaluate(() => {
                    // 查找所有包含"确定"、"确认"、"OK"文本的按钮
                    const allButtons = Array.from(document.querySelectorAll('button'));
                    for (const btn of allButtons) {
                        const text = btn.textContent.trim();
                        if (text === '确定' || text === '确认' || text === 'OK' || text === '关闭') {
                            // 检查这个按钮是否在可见的模态框中
                            let parent = btn.parentElement;
                            while (parent) {
                                const style = window.getComputedStyle(parent);
                                if (style.display !== 'none' && style.visibility !== 'hidden') {
                                    if (parent.classList.contains('modal') || 
                                        parent.classList.contains('dialog') ||
                                        parent.getAttribute('role') === 'dialog' ||
                                        style.position === 'fixed' ||
                                        style.zIndex > 1000) {
                                        btn.click();
                                        return true;
                                    }
                                }
                                parent = parent.parentElement;
                            }
                        }
                    }
                    // 如果没有找到特定按钮，尝试点击第一个可见的模态框中的按钮
                    const modalSelectors = [
                        '.modal', '.dialog', '[role="dialog"]',
                        '.ant-modal', '.el-dialog', '.v-modal',
                        '.ones-modal', '.modal-content'
                    ];
                    
                    for (const selector of modalSelectors) {
                        try {
                            const modals = document.querySelectorAll(selector);
                            for (const modal of modals) {
                                const style = window.getComputedStyle(modal);
                                if (style.display !== 'none' && 
                                    style.visibility !== 'hidden' && 
                                    parseFloat(style.opacity) > 0) {
                                    const buttons = modal.querySelectorAll('button');
                                    if (buttons.length > 0) {
                                        buttons[buttons.length - 1].click(); // 点击最后一个按钮（通常是确认）
                                        return true;
                                    }
                                }
                            }
                        } catch (e) {
                            // 忽略
                        }
                    }
                    return false;
                });
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`    ✓ 已确认弹窗`);
                break;
            } else if (result.type === 'success') {
                console.log(`    ✓ 解析成功`);
                parseSuccess = true;
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
            console.log(`    → 等待中... (${waited/1000}s)`);
        }
        
        // 步骤4.7: 如果解析成功，下载结果
        if (parseSuccess) {
            console.log(`    → 下载解析结果...`);
            const downloadButton = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const button of buttons) {
                    const text = button.textContent.trim();
                    if ((text.includes('下载') || text.includes('Download')) && 
                        (text.includes('结果') || text.includes('Result'))) {
                        return button;
                    }
                }
                return null;
            });
            
            if (downloadButton) {
                // 监听下载事件
                const downloadPromise = new Promise((resolve) => {
                    client.on('Page.downloadWillBegin', (event) => {
                        console.log(`    → 开始下载: ${event.suggestedFilename}`);
                    });
                    
                    client.on('Page.downloadProgress', (event) => {
                        if (event.state === 'completed') {
                            resolve();
                        }
                    });
                });
                
                await downloadButton.click();
                await downloadPromise;
                
                // 等待文件写入完成
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                console.log(`    ✓ 解析结果下载完成`);
                
                // 步骤4.8: 解析下载的文件
                console.log(`    → 查找并解析下载的文件...`);
                await parseResultFiles(bugDir, bugId);
            } else {
                console.log(`    ⚠ 未找到下载结果按钮`);
            }
        } else {
            console.log(`    ⚠ 解析失败或超时，跳过下载`);
        }
        
    } finally {
        await page.close();
    }
}

/**
 * 解压缩目录下的所有 zip 文件
 */
async function extractZipFiles(bugDir, bugId) {
    console.log(`  → 检查并解压压缩文件...`);
    
    const files = fs.readdirSync(bugDir);
    const zipFiles = files.filter(f => f.toLowerCase().endsWith('.zip'));
    
    if (zipFiles.length === 0) {
        console.log(`  ⚠ 未找到 zip 文件`);
        return;
    }
    
    console.log(`  → 找到 ${zipFiles.length} 个 zip 文件: ${zipFiles.join(', ')}`);
    
    for (const zipFile of zipFiles) {
        const zipPath = path.join(bugDir, zipFile);
        const extractDir = path.join(bugDir, path.basename(zipFile, '.zip'));
        
        try {
            console.log(`    → 解压: ${zipFile}`);
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractDir, true); // true = 覆盖已存在的文件
            console.log(`    ✓ 解压完成: ${extractDir}`);
        } catch (error) {
            console.log(`    ✗ 解压失败: ${error.message}`);
        }
    }
}

/**
 * 解析结果文件
 */
async function parseResultFiles(bugDir, bugId) {
    // 读取目录中的所有文件
    const files = fs.readdirSync(bugDir);
    
    console.log(`    → 目录中的文件: ${files.join(', ')}`);
    
    // 查找 result 文件（可能是 .txt, .json, .log 等）
    const resultFiles = files.filter(f => 
        f.toLowerCase().includes('result') || 
        f.toLowerCase().includes('parse') ||
        f.toLowerCase().includes('analysis')
    );
    
    // 查找 log 文件
    const logFiles = files.filter(f => 
        f.toLowerCase().includes('log') && f.endsWith('.zip')
    );
    
    console.log(`    → 找到 Result 文件: ${resultFiles.length} 个`);
    console.log(`    → 找到 Log 文件: ${logFiles.length} 个`);
    
    // 这里可以添加具体的解析逻辑
    // 例如：解压 zip 文件、解析文本内容等
    
    for (const resultFile of resultFiles) {
        const filePath = path.join(bugDir, resultFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        console.log(`    → 解析 ${resultFile}: ${content.length} 字节`);
        
        // 根据文件类型进行不同的解析
        if (resultFile.endsWith('.json')) {
            try {
                const data = JSON.parse(content);
                console.log(`    → JSON 解析成功`);
                // 可以在这里提取关键信息
            } catch (e) {
                console.log(`    → JSON 解析失败: ${e.message}`);
            }
        }
    }
}

/**
 * 主函数
 */
async function main() {
    // 获取命令行参数
    const args = process.argv.slice(2);
    const jsonFile = args[0];
    
    if (!jsonFile) {
        console.error('用法: node process_bugs.js <json文件路径>');
        console.error('示例: node process_bugs.js output/bugs_2026-05-12_xxx.json');
        process.exit(1);
    }
    
    // 读取 JSON 文件
    console.log(`读取 JSON 文件: ${jsonFile}`);
    const jsonData = fs.readFileSync(jsonFile, 'utf-8');
    const bugs = JSON.parse(jsonData);
    
    console.log(`找到 ${bugs.length} 个 Bug\n`);
    
    if (bugs.length === 0) {
        console.log('没有需要处理的 Bug');
        return;
    }
    
    // 步骤1: 创建日期目录
    const firstBug = bugs[0];
    const dateMatch = firstBug.created_at.match(/(\d{4}-\d{2}-\d{2})/);
    const dateDir = dateMatch ? dateMatch[1] : 'unknown_date';
    const baseDir = path.join(__dirname, 'processed_bugs', dateDir);
    
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    console.log(`创建日期目录: ${baseDir}\n`);
    
    // 启动浏览器
    console.log('启动浏览器...');
    const browser = await puppeteer.launch({
        headless: false, // 设置为 true 可以在后台运行
        slowMo: 50,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        // 步骤2-4: 处理每个 Bug
        for (let i = 0; i < bugs.length; i++) {
            const bug = bugs[i];
            console.log(`\n========== [${i + 1}/${bugs.length}] ==========`);
            
            try {
                await processBug(bug, baseDir, browser);
            } catch (error) {
                console.error(`处理 Bug ${bug.id} 时出错:`, error.message);
            }
        }
        
        console.log('\n========== 所有 Bug 处理完成 ==========');
        console.log(`结果保存在: ${baseDir}`);
        
    } finally {
        await browser.close();
    }
}

// 运行主函数
main().catch(console.error);
