const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    url: 'https://ones.autoai.com/project/#/team/TEakUst8/project/GJLD/component/9p616bX9/view/DL8fAMwo/issue/',
    username: 'dongzq@autoai.com',
    password: 'isbn7810@Autoai'
};

async function extractBugsSmart() {
    console.log('使用智能方式提取Bug信息...\n');
    
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 50,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('打开页面并登录...');
    await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 登录
    await new Promise(resolve => setTimeout(resolve, 3000));
    const usernameInput = await page.$('input[type="text"], input[type="email"]');
    const passwordInput = await page.$('input[type="password"]');
    
    if (usernameInput && passwordInput) {
        await usernameInput.click({ clickCount: 3 });
        await usernameInput.type(CONFIG.username, { delay: 100 });
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.type(CONFIG.password, { delay: 100 });
        
        const loginBtn = await page.$('button[type="submit"]');
        if (loginBtn) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
                loginBtn.click()
            ]);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 检查是否仍在登录页面
        const currentUrl = page.url();
        console.log(`当前URL: ${currentUrl}`);
        if (currentUrl.includes('/auth/login')) {
            console.log('⚠️ 仍在登录页面,等待更长时间...');
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            // 再次检查
            const newUrl = page.url();
            console.log(`再次检查URL: ${newUrl}`);
        }
        
        console.log('✓ 登录完成\n');
    }
    
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 25000));
    
    // 获取命令行参数
    const args = process.argv.slice(2);
    const dateParam = args[0] || '2026-05-12';
    const keyword = args[1] || '';
    const projectName = args[2] || '';
    
    console.log(`过滤条件:`);
    console.log(`  日期: ${dateParam}`);
    console.log(`  关键字: ${keyword || '无'}`);
    console.log(`  项目名: ${projectName || '无'}\n`);
    
    // 使用JavaScript直接解析页面内容,获取Bug列表
    console.log('正在提取Bug列表...');
    
    // 先检查页面文本长度
    const textLength = await page.evaluate(() => document.body.innerText.length);
    console.log(`页面文本长度: ${textLength}`);
    
    const bugList = await page.evaluate((targetDate, searchKeyword, searchProject) => {
        const text = document.body.innerText;
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        const bugs = [];
        let currentBug = null;
        
        // 遍历每一行,识别Bug模式
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 检查是否是Bug ID行 (格式: GJLD-XXXXXX)
            const bugIdMatch = line.match(/GJLD-\d+/);
            if (bugIdMatch) {
                // 保存上一个Bug
                if (currentBug) {
                    bugs.push(currentBug);
                }
                
                // 创建新的Bug对象
                currentBug = {
                    id: bugIdMatch[0],
                    title: '',
                    priority: '',
                    status: '',
                    assignee: '',
                    created_at: '',
                    reporter: ''
                };
                
                // 标题通常是ID的下一行或同一行的其他部分
                if (i + 1 < lines.length) {
                    currentBug.title = lines[i + 1];
                }
                
                continue;
            }
            
            // 如果当前有Bug对象,尝试填充其他字段
            if (currentBug) {
                // 优先级 (P0, P1, P2, etc.)
                if (/^P[0-4]$/.test(line)) {
                    currentBug.priority = line;
                }
                
                // 状态
                if (line.includes('问题提出') || line.includes('进行中') || 
                    line.includes('已完成') || line.includes('未开始')) {
                    currentBug.status = line;
                }
                
                // 指派人 (通常是一个人名,2-4个中文字符)
                // 需要排除"问题提出"这样的状态文本
                if (/^[一-龥]{2,4}$/.test(line) && !line.includes('助手') && 
                    !line.includes('问题') && !line.includes('完成') && !line.includes('开始')) {
                    if (!currentBug.assignee || currentBug.assignee === '问题提出') {
                        currentBug.assignee = line;
                    }
                }
                
                // 报告人
                if (line.includes('日志平台告警助手')) {
                    currentBug.reporter = line;
                }
                
                // 日期时间 (格式: 2026-05-12 HH:MM:SS)
                const dateMatch = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
                if (dateMatch) {
                    currentBug.created_at = dateMatch[0];
                    
                    // 检查是否符合日期过滤(暂时禁用)
                    // if (!currentBug.created_at.startsWith(targetDate)) {
                    //     currentBug = null; // 不符合日期要求,丢弃
                    // }
                }
            }
        }
        
        // 添加最后一个Bug
        if (currentBug) {
            bugs.push(currentBug);
        }
        
        // 过滤逻辑：先匹配项目名，再匹配关键字
        let filteredBugs = bugs;
        
        // 第一步：如果提供了项目名，先按项目名过滤
        if (searchProject) {
            filteredBugs = filteredBugs.filter(bug => 
                bug.title.toLowerCase().includes(searchProject.toLowerCase())
            );
        }
        
        // 第二步：如果提供了关键字，再按关键字过滤
        if (searchKeyword) {
            filteredBugs = filteredBugs.filter(bug => 
                bug.title.toLowerCase().includes(searchKeyword.toLowerCase())
            );
        }
        
        return filteredBugs;
    }, dateParam, keyword, projectName);
    
    console.log(`✓ 找到 ${bugList.length} 个符合条件的Bug\n`);
    
    // DEBUG模式: 只处理前2个Bug
    const debugMode = true;
    const bugsToProcess = debugMode ? bugList.slice(0, 2) : bugList;
    
    if (debugMode) {
        console.log(`⚠️  DEBUG模式: 只处理前 ${bugsToProcess.length} 个Bug\n`);
    }
    
    // 对每个Bug,点击打开详情并提取额外信息
    const bugsWithDetails = [];
    let processedCount = 0;
    
    console.log('开始提取每个Bug的详细信息...\n');
    
    for (const bug of bugsToProcess) {
        processedCount++;
        console.log(`[${processedCount}/${bugList.length}] 处理 ${bug.id}...`);
        
        try {
            // 查找并点击Bug - 优先点击标题,其次点击ID
            let bugElement = null;
            
            console.log(`  → 查找Bug元素...`);
            
            // 方法1: 查找包含Bug标题的元素(通常是链接)
            const allElements = await page.$$('a, span, div');
            console.log(`  → 找到 ${allElements.length} 个元素`);
            
            for (const el of allElements) {
                try {
                    const text = await page.evaluate(e => e.textContent.trim(), el);
                    // 匹配标题 - 标题通常在ID后面一行
                    if (text && text.includes(bug.title.substring(0, 20))) {  // 匹配标题前20个字符
                        const isClickable = await page.evaluate(e => {
                            return e.tagName === 'A' || 
                                   window.getComputedStyle(e).cursor === 'pointer' ||
                                   e.closest('a') !== null;
                        }, el);
                        
                        if (isClickable) {
                            bugElement = el;
                            console.log(`  → 找到标题元素: ${text.substring(0, 50)}`);
                            break;
                        }
                    }
                } catch (e) {
                    // 元素可能已经失效，跳过
                    continue;
                }
            }
            
            // 方法2: 如果没找到标题,尝试点击ID
            if (!bugElement) {
                console.log(`  → 未找到标题,尝试点击ID...`);
                for (const el of allElements) {
                    try {
                        const text = await page.evaluate(e => e.textContent.trim(), el);
                        if (text === bug.id || (text.includes(bug.id) && text.length < 30)) {
                            bugElement = el;
                            console.log(`  → 找到ID元素: ${text}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            if (!bugElement) {
                console.log(`  ✗ 未找到Bug元素,跳过`);
                bugsWithDetails.push({
                    ...bug,
                    vin: '',
                    build_version: '',
                    compile_type: '',
                    log_address: '',
                    issue_time: ''
                });
                continue;
            }
            
            // 点击Bug元素打开详情 - 监听导航
            console.log(`  → 准备点击...`);
            
            // 同时监听导航和点击
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {
                    console.log(`  → 导航超时或无导航`);
                }),
                bugElement.click()
            ]);
            
            console.log(`  → 已点击,等待详情页加载...`);
            
            // 额外等待确保内容加载
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // 调试: 检查当前页面状态
            const pageState = await page.evaluate(() => {
                return {
                    url: window.location.href,
                    hasModal: !!document.querySelector('.modal, .popup, .drawer, [class*="modal"], [class*="popup"], [class*="drawer"]'),
                    bodyTextLength: document.body.innerText.length,
                    iframes: document.querySelectorAll('iframe').length
                };
            });
            console.log(`  → 页面状态: URL=${pageState.url.substring(0, 80)}, 有弹窗=${pageState.hasModal}, 文本长度=${pageState.bodyTextLength}, iframe数=${pageState.iframes}`);
            
            // 尝试点击"详情"选项卡
            console.log(`  → 查找并点击"详情"选项卡...`);
            await page.evaluate(() => {
                // 查找包含"详情"文字的标签页或按钮
                const allElements = Array.from(document.querySelectorAll('*'));
                for (const el of allElements) {
                    const text = el.textContent.trim();
                    if ((text === '详情' || text.includes('详情')) && (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV')) {
                        // 检查是否可点击
                        const style = window.getComputedStyle(el);
                        if (style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.closest('button')) {
                            el.click();
                            console.log('已点击详情选项卡');
                            break;
                        }
                    }
                }
            });
            
            // 等待选项卡内容加载，增加等待时间确保动态内容完全加载
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 额外等待网络请求完成
            try {
                await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {
                    console.log('  → 网络空闲超时，继续提取');
                });
            } catch (e) {
                // 忽略错误
            }
            
            // 从详情页提取额外信息
            const details = await page.evaluate(() => {
                const details = {
                    vin: '',
                    build_version: '',
                    compile_type: '',
                    log_address: '',
                    issue_time: ''
                };
                
                // 获取整个页面的文本内容
                const fullText = document.body.innerText;
                
                console.log('详情页文本长度:', fullText.length);
                
                // 提取VIN号 - 匹配"车辆VIN号："后面的内容
                const vinMatch = fullText.match(/车辆VIN号\s*：\s*([A-Z0-9]+)/i) || 
                                fullText.match(/VIN号\s*：\s*([A-Z0-9]+)/i) ||
                                fullText.match(/VIN\s*[:：]\s*([A-Z0-9]{17})/i);
                if (vinMatch) {
                    details.vin = vinMatch[1].trim();
                    console.log('找到VIN:', details.vin);
                }
                
                // 提取Build版本 - 匹配"Build版本："后面的内容
                const buildMatch = fullText.match(/Build版本[:\s]*：?\s*(.+)/i);
                if (buildMatch) {
                    details.build_version = buildMatch[1].trim();
                    console.log('找到Build版本:', details.build_version.substring(0, 60));
                }
                
                // 提取编译类型 - 匹配"编译类型："后面的内容
                const compileTypeMatch = fullText.match(/编译类型[:\s]*：?\s*(.+)/i);
                if (compileTypeMatch) {
                    details.compile_type = compileTypeMatch[1].trim();
                    console.log('找到编译类型:', details.compile_type);
                }
                
                // 提取Log地址 - 从 link 属性中提取
                console.log('开始提取Log地址...');
                
                // 策略1: 查找包含 link 属性的元素（如 <span link="...">）
                const elementsWithLink = document.querySelectorAll('[link]');
                console.log(`找到 ${elementsWithLink.length} 个带link属性的元素`);
                
                for (const element of elementsWithLink) {
                    const linkAttr = element.getAttribute('link');
                    const text = (element.textContent || '').trim();
                    
                    console.log(`检查元素: text="${text.substring(0, 30)}", link="${linkAttr ? linkAttr.substring(0, 100) : 'none'}"`);
                    
                    if (linkAttr && linkAttr.length > 10) {
                        // 优先选择包含“下载”、“log”、“monitor”等关键字的链接
                        if (text.includes('下载') || 
                            linkAttr.toLowerCase().includes('log') || 
                            linkAttr.toLowerCase().includes('download') ||
                            linkAttr.toLowerCase().includes('monitor')) {
                            details.log_address = linkAttr;
                            console.log('✓ 从link属性找到Log地址:', details.log_address.substring(0, 150));
                            return details;
                        }
                    }
                }
                
                // 策略2: 如果没找到，尝试从所有元素的自定义属性中查找
                const allElements = Array.from(document.querySelectorAll('*'));
                for (const element of allElements) {
                    try {
                        const attrs = element.attributes;
                        for (const attr of attrs) {
                            const attrName = attr.name.toLowerCase();
                            const attrValue = attr.value || '';
                            
                            // 查找名为 link、data-link、url、href 等的属性
                            if ((attrName === 'link' || attrName === 'data-link' || attrName === 'data-url') && 
                                attrValue.length > 10 &&
                                (attrValue.toLowerCase().includes('log') || 
                                 attrValue.toLowerCase().includes('download') ||
                                 attrValue.toLowerCase().includes('monitor'))) {
                                details.log_address = attrValue;
                                console.log('✓ 从自定义属性找到Log地址:', details.log_address.substring(0, 150));
                                return details;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
                
                // 策略3: 从文本中提取云存储链接或API链接
                const urlPatterns = [
                    // 匹配 shawngw-dev.autoai.com 的下载链接
                    /https?:\/\/[\w.-]+\.autoai\.com\/[\w./-]*download[\w./-]*/gi,
                    /https?:\/\/[\w.-]+\.autoai\.com\/[\w./-]*log[\w./-]*/gi,
                    // 匹配 KS3 云存储链接
                    /https?:\/\/[\w.-]+\.ksyuncs\.com\/[\w./-]*/gi,
                ];
                
                for (const pattern of urlPatterns) {
                    const matches = fullText.match(pattern);
                    if (matches && matches.length > 0) {
                        details.log_address = matches[0];
                        console.log('✓ 从文本中找到URL:', details.log_address.substring(0, 150));
                        return details;
                    }
                }
                
                console.log('✗ 未找到Log地址');

                // 提取问题时间 - 匹配"问题时间："后面的日期时间
                const issueTimeMatch = fullText.match(/问题时间\s*：\s*\d+\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i) ||
                                      fullText.match(/问题时间\s*：\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
                if (issueTimeMatch) {
                    details.issue_time = issueTimeMatch[1];
                    console.log('找到问题时间:', details.issue_time);
                }
                
                return details;
            });
            
            // 合并基本信息和详情信息
            const bugWithDetails = {
                ...bug,
                ...details
            };
            
            bugsWithDetails.push(bugWithDetails);
            console.log(`  ✓ 提取成功`);
            if (details.vin) console.log(`    VIN: ${details.vin}`);
            if (details.build_version) console.log(`    Build: ${details.build_version.substring(0, 60)}...`);
            if (details.compile_type) console.log(`    编译类型: ${details.compile_type}`);
            if (details.log_address) console.log(`    Log: ${details.log_address.substring(0, 80)}...`);
            if (details.issue_time) console.log(`    问题时间: ${details.issue_time}`);
            
            // 返回到列表页
            console.log(`  → 返回列表页...`);
            await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log(`  → 已返回列表页`);
            
        } catch (error) {
            console.log(`  ✗ 提取失败: ${error.message}`);
            
            // 确保返回列表页
            try {
                await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (e) {
                console.log(`  → 返回列表页失败`);
            }
            
            // 添加基本信息,详情为空
            bugsWithDetails.push({
                ...bug,
                vin: '',
                build_version: '',
                log_address: '',
                issue_time: ''
            });
        }
    }
    
    console.log(`\n========== 提取完成 ==========`);
    console.log(`总共处理: ${processedCount} 个Bug`);
    console.log(`成功提取详情: ${bugsWithDetails.filter(b => b.vin || b.build_version || b.log_address).length} 个Bug`);
    
    // 显示前几个Bug的信息
    if (bugsWithDetails.length > 0) {
        console.log('\n=== 前3个Bug示例 ===\n');
        bugsWithDetails.slice(0, 3).forEach((bug, index) => {
            console.log(`${index + 1}. ${bug.id}`);
            console.log(`   标题: ${bug.title}`);
            console.log(`   优先级: ${bug.priority}`);
            console.log(`   状态: ${bug.status}`);
            console.log(`   指派人: ${bug.assignee}`);
            console.log(`   创建时间: ${bug.created_at}`);
            console.log(`   VIN: ${bug.vin || '未找到'}`);
            console.log(`   Build版本: ${bug.build_version || '未找到'}`);
            console.log(`   Log地址: ${bug.log_address ? bug.log_address.substring(0, 60) + '...' : '未找到'}`);
            console.log(`   问题时间: ${bug.issue_time || '未找到'}`);
            console.log('');
        });
    }
    
    // 保存到JSON文件
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(outputDir, `bugs_${dateParam}_${timestamp}.json`);
    
    fs.writeFileSync(outputFile, JSON.stringify(bugsWithDetails, null, 2), 'utf-8');
    
    console.log(`结果已保存到: ${outputFile}\n`);
    
    await browser.close();
}

extractBugsSmart().catch(console.error);
