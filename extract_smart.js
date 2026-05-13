const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    url: 'https://ones.autoai.com/project/#/team/TEakUst8/project/GJLD/component/9p616bX9/view/DL8fAMwo/issue/',
    username: 'dongzq@autoai.com',
    password: 'isbn7810@Autoai'
};

/**
 * 自动滚动页面以加载所有内容
 * @param {Object} page - Puppeteer page 对象
 * @param {string} targetDate - 目标日期，用于判断是否继续滚动
 */
async function autoScrollAndExtract(page, targetDate, keyword, projectName) {
    console.log('→ 开始智能滚动并逐个提取Bug...');
    console.log(`  → 目标日期: ${targetDate}，将滚动直到发现早于此日期的Bug`);
    console.log(`  → 关键字: ${keyword || '无'}`);
    console.log(`  → 项目名: ${projectName || '无'}\n`);
    
    const extractedBugIds = new Set(); // 记录已提取的 Bug ID
    const allBugs = []; // 存储所有提取的 Bug
    let scrollRound = 0;
    let foundOlderBug = false;
    
    while (!foundOlderBug) {
        scrollRound++;
        console.log(`\n========== 第 ${scrollRound} 轮滚动 ==========`);
        
        // 第一步：在当前页面查找符合条件的 Bug
        console.log('→ 查找当前页面中的 Bug...');
        const currentBugs = await page.evaluate((searchKeyword, searchProject) => {
            const bugs = [];
            
            // 查找虚拟列表容器
            const gridContainer = document.querySelector('#multi_function_table');
            if (!gridContainer) {
                return bugs;
            }
            
            // 获取所有包含 task-description 的行
            const titleElements = Array.from(gridContainer.querySelectorAll('.task-description.one-line--ellipsis'));
            
            for (const titleEl of titleElements) {
                try {
                    // 获取 span 标签的内容（Bug 标题）
                    const spanEl = titleEl.querySelector('span');
                    if (!spanEl) continue;
                    
                    const title = (spanEl.textContent || '').trim();
                    if (!title) continue;
                    
                    // 如果有关键字，先过滤
                    if (searchKeyword && !title.toLowerCase().includes(searchKeyword.toLowerCase())) {
                        continue;
                    }
                    
                    // 如果有项目名，再过滤
                    if (searchProject && !title.toLowerCase().includes(searchProject.toLowerCase())) {
                        continue;
                    }
                    
                    // 向上查找父级行元素
                    let rowElement = titleEl;
                    while (rowElement && !rowElement.hasAttribute('data-row-index')) {
                        rowElement = rowElement.parentElement;
                    }
                    
                    if (!rowElement) continue;
                    
                    const rowIndex = rowElement.getAttribute('data-row-index');
                    const rowId = rowElement.id;
                    
                    // 从 rowId 提取前缀
                    const idParts = rowId.split('-field001-');
                    if (idParts.length < 2) continue;
                    const rowPrefix = idParts[0];
                    
                    // 提取 Bug ID (field903)
                    let bugId = '';
                    const bugIdSelector = `[id^="${rowPrefix}-field903-"][data-row-index="${rowIndex}"]`;
                    const bugIdElement = gridContainer.querySelector(bugIdSelector);
                    if (bugIdElement) {
                        const bugIdText = (bugIdElement.textContent || '').trim();
                        const idMatch = bugIdText.match(/GJLD-\d+/);
                        if (idMatch) {
                            bugId = idMatch[0];
                        }
                    }
                    
                    if (!bugId) continue;
                    
                    // 提取日期时间 (field009)
                    let created_at = '';
                    const dateSelector = `[id^="${rowPrefix}-field009-"][data-row-index="${rowIndex}"]`;
                    const dateElement = gridContainer.querySelector(dateSelector);
                    if (dateElement) {
                        const dateText = (dateElement.textContent || '').trim();
                        const dateMatch = dateText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
                        if (dateMatch) {
                            created_at = dateMatch[0];
                        }
                    }
                    
                    bugs.push({
                        id: bugId,
                        title: title,
                        created_at: created_at,
                        rowIndex: rowIndex
                    });
                } catch (e) {
                    // 忽略错误
                }
            }
            
            return bugs;
        }, keyword, projectName);
        
        console.log(`  → 当前页面找到 ${currentBugs.length} 个符合条件的Bug`);
        
        // 第二步：检查是否发现早于目标日期的 Bug
        if (currentBugs.length > 0) {
            const dates = currentBugs.map(b => b.created_at).filter(d => d).sort();
            if (dates.length > 0) {
                const earliestDate = dates[0].split(' ')[0];
                console.log(`  → 最早日期: ${earliestDate}`);
                
                if (earliestDate < targetDate) {
                    console.log(`  ✓ 已发现早于 ${targetDate} 的Bug，将在处理完当前页面后停止`);
                    foundOlderBug = true;
                }
            }
        }
        
        // 第三步：逐个处理当前页面的 Bug
        for (const bug of currentBugs) {
            if (extractedBugIds.has(bug.id)) {
                console.log(`  ⊘ 跳过已处理的 Bug: ${bug.id}`);
                continue;
            }
            
            // 先检查日期是否符合要求（只比较日期部分）
            if (bug.created_at) {
                const bugDate = bug.created_at.split(' ')[0];
                if (bugDate !== targetDate) {
                    console.log(`  ⊘ 跳过日期不符的 Bug: ${bug.id} (日期: ${bugDate}, 目标: ${targetDate})`);
                    continue;
                }
            } else {
                console.log(`  ⊘ 跳过无日期的 Bug: ${bug.id}`);
                continue;
            }
            
            console.log(`  → 处理 Bug: ${bug.id} - ${bug.title.substring(0, 50)}...`);
            
            try {
                // 点击 Bug 标题打开详情弹窗
                const clicked = await page.evaluate((bugId) => {
                    // 查找包含该 Bug ID 的标题元素
                    const titleElements = Array.from(document.querySelectorAll('.task-description.one-line--ellipsis'));
                    
                    for (const titleEl of titleElements) {
                        const spanEl = titleEl.querySelector('span');
                        if (!spanEl) continue;
                        
                        const title = (spanEl.textContent || '').trim();
                        
                        // 向上查找父级行元素获取 Bug ID
                        let rowElement = titleEl;
                        while (rowElement && !rowElement.hasAttribute('data-row-index')) {
                            rowElement = rowElement.parentElement;
                        }
                        
                        if (!rowElement) continue;
                        
                        const rowIndex = rowElement.getAttribute('data-row-index');
                        const rowId = rowElement.id;
                        const idParts = rowId.split('-field001-');
                        if (idParts.length < 2) continue;
                        const rowPrefix = idParts[0];
                        
                        // 提取 Bug ID
                        const bugIdSelector = `[id^="${rowPrefix}-field903-"][data-row-index="${rowIndex}"]`;
                        const bugIdElement = document.querySelector(bugIdSelector);
                        if (!bugIdElement) continue;
                        
                        const bugIdText = (bugIdElement.textContent || '').trim();
                        const idMatch = bugIdText.match(/GJLD-\d+/);
                        if (!idMatch || idMatch[0] !== bugId) continue;
                        
                        // 找到匹配的 Bug，点击标题
                        console.log(`找到 Bug ${bugId} 的标题元素，准备点击...`);
                        
                        // 尝试点击标题元素本身或其父级链接
                        let clickTarget = titleEl;
                        // 查找最近的链接
                        const linkEl = titleEl.closest('a');
                        if (linkEl) {
                            clickTarget = linkEl;
                        }
                        
                        clickTarget.click();
                        return true;
                    }
                    
                    return false;
                }, bug.id);
                
                if (!clicked) {
                    console.log(`    ⚠️ 无法点击 Bug ${bug.id}`);
                    continue;
                }
                
                // 等待弹窗加载
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // 尝试点击"详情"选项卡
                await page.evaluate(() => {
                    const allElements = Array.from(document.querySelectorAll('*'));
                    for (const el of allElements) {
                        const text = el.textContent.trim();
                        if ((text === '详情' || text.includes('详情')) && 
                            (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV')) {
                            const style = window.getComputedStyle(el);
                            if (style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.closest('button')) {
                                el.click();
                                break;
                            }
                        }
                    }
                });
                
                // 等待选项卡内容加载
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 从详情页提取额外信息
                const details = await page.evaluate(() => {
                    const details = {
                        vin: '',
                        build_version: '',
                        compile_type: '',
                        log_address: '',
                        issue_time: ''
                    };
                    
                    const fullText = document.body.innerText;
                    
                    // 提取VIN号
                    const vinMatch = fullText.match(/车辆VIN号\s*：\s*([A-Z0-9]+)/i) || 
                                    fullText.match(/VIN号\s*：\s*([A-Z0-9]+)/i) ||
                                    fullText.match(/VIN\s*[:：]\s*([A-Z0-9]{17})/i);
                    if (vinMatch) {
                        details.vin = vinMatch[1].trim();
                    }
                    
                    // 提取Build版本
                    const buildMatch = fullText.match(/Build版本[:\s]*：?\s*(.+)/i);
                    if (buildMatch) {
                        details.build_version = buildMatch[1].trim();
                    }
                    
                    // 提取编译类型
                    const compileTypeMatch = fullText.match(/编译类型[:\s]*：?\s*(.+)/i);
                    if (compileTypeMatch) {
                        details.compile_type = compileTypeMatch[1].trim();
                    }
                    
                    // 提取Log地址 - 从 link 属性中提取
                    const elementsWithLink = document.querySelectorAll('[link]');
                    for (const element of elementsWithLink) {
                        const linkAttr = element.getAttribute('link');
                        const text = (element.textContent || '').trim();
                        
                        if (linkAttr && linkAttr.length > 10) {
                            if (text.includes('下载') || 
                                linkAttr.toLowerCase().includes('log') || 
                                linkAttr.toLowerCase().includes('download') ||
                                linkAttr.toLowerCase().includes('monitor')) {
                                details.log_address = linkAttr;
                                break;
                            }
                        }
                    }
                    
                    return details;
                });
                
                // 合并详细信息到 Bug 对象
                const bugWithDetails = {
                    ...bug,
                    vin: details.vin || '',
                    build_version: details.build_version || '',
                    compile_type: details.compile_type || '',
                    log_address: details.log_address || '',
                    issue_time: details.issue_time || ''
                };
                
                // 标记为已提取
                extractedBugIds.add(bug.id);
                allBugs.push(bugWithDetails);
                
                console.log(`    ✓ 已提取 Bug ${bug.id}`);
                if (details.vin) console.log(`      VIN: ${details.vin}`);
                if (details.build_version) console.log(`      Build: ${details.build_version.substring(0, 60)}...`);
                if (details.compile_type) console.log(`      编译类型: ${details.compile_type}`);
                if (details.log_address) console.log(`      Log: ${details.log_address.substring(0, 80)}...`);
                
                // 关闭弹窗（按 ESC）
                await page.keyboard.press('Escape');
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (e) {
                console.log(`    ✗ 处理 Bug ${bug.id} 时出错:`, e.message);
            }
        }
        
        // 如果已经发现早于目标日期的 Bug，停止滚动
        if (foundOlderBug) {
            console.log('\n✓ 已发现早于目标日期的 Bug，停止滚动');
            break;
        }
        
        // 第四步：滚动到下一批 Bug
        console.log('\n→ 滚动到下一批 Bug...');
        const scrollResult = await page.evaluate(() => {
            const gridContainer = document.querySelector('#multi_function_table, .ReactVirtualized__Grid');
            
            if (gridContainer) {
                const oldScrollTop = gridContainer.scrollTop;
                const scrollAmount = 300;
                
                gridContainer.scrollTop += scrollAmount;
                
                const newScrollTop = gridContainer.scrollTop;
                const scrolledPixels = newScrollTop - oldScrollTop;
                
                return { 
                    success: scrolledPixels > 0,
                    oldScrollTop,
                    newScrollTop,
                    scrolledPixels
                };
            } else {
                window.scrollBy(0, 300);
                return { success: true, isPageScroll: true };
            }
        });
        
        if (scrollResult.isPageScroll) {
            console.log('  → 未找到虚拟列表容器，已滚动整个页面');
        } else if (scrollResult.success) {
            console.log(`  → ✓ 滚动了 ${scrollResult.scrolledPixels}px (从 ${scrollResult.oldScrollTop} 到 ${scrollResult.newScrollTop})`);
        } else {
            console.log('  → ✗ 无法继续滚动（可能已到达底部）');
            break;
        }
        
        // 等待新内容加载
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n========== 提取完成 ==========)`);
    console.log(`总共滚动 ${scrollRound} 轮`);
    console.log(`总共提取 ${allBugs.length} 个Bug`);
    
    return allBugs;
}

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
    
    // 等待页面完全加载
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 登录
    let usernameInput = null;
    let passwordInput = null;
    
    try {
        usernameInput = await page.$('input[type="text"], input[type="email"]');
        passwordInput = await page.$('input[type="password"]');
    } catch (e) {
        console.log('⚠️ 查找登录元素时出错:', e.message);
    }
    
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
    
    // 尝试设置每页显示最大数量的Bug
    console.log('→ 尝试设置每页显示最大数量...');
    try {
        const pageSizeSet = await page.evaluate(() => {
            // 查找每页显示数量的下拉框或输入框
            const allElements = Array.from(document.querySelectorAll('*'));
            for (const el of allElements) {
                const text = (el.textContent || '').trim();
                const className = String(el.className || '');
                
                // 查找包含“每页”、“条/页”、“page size”等文字的元系
                if ((text.includes('每页') || text.includes('条/页') || text.includes('page size') ||
                     className.toLowerCase().includes('pagesize') || className.toLowerCase().includes('page-size')) &&
                    (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'BUTTON' ||
                     window.getComputedStyle(el).cursor === 'pointer')) {
                    
                    if (el.tagName === 'SELECT') {
                        // 如果是下拉框，选择最大值
                        const options = Array.from(el.options);
                        const maxOption = options.reduce((max, opt) => {
                            const val = parseInt(opt.value) || 0;
                            return val > max ? val : max;
                        }, 0);
                        
                        if (maxOption > 0) {
                            el.value = String(maxOption);
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log(`已设置每页显示 ${maxOption} 条`);
                            return true;
                        }
                    } else {
                        // 点击打开下拉菜单
                        el.click();
                        console.log('已点击每页显示数量控件');
                        return true;
                    }
                }
            }
            return false;
        });
        
        if (pageSizeSet) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } catch (e) {
        console.log('设置每页显示数量失败:', e.message);
    }
    
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
    
    // 先检查页面状态
    const pageState = await page.evaluate(() => {
        return {
            url: window.location.href,
            bodyTextLength: document.body.innerText.length,
            scrollHeight: document.body.scrollHeight,
            clientHeight: document.documentElement.clientHeight,
            hasIssueList: !!document.querySelector('.issue-list, .bug-list, [class*="issue"], [class*="bug"]'),
            bugCount: (document.body.innerText.match(/GJLD-\d+/g) || []).length,
            // 检查是否有滚动容器
            scrollContainers: Array.from(document.querySelectorAll('[style*="overflow"], [class*="scroll"], [class*="list"]')).length,
            // 检查是否有“加载更多”按钮
            hasLoadMore: !!Array.from(document.querySelectorAll('*')).find(el => 
                el.textContent && (el.textContent.includes('加载更多') || el.textContent.includes('Load More'))
            ),
            // 获取所有包含分页相关文字的文本
            paginationTexts: Array.from(document.querySelectorAll('*'))
                .map(el => (el.textContent || '').trim())
                .filter(text => text && (/\d+\/\d+/.test(text) || /共/.test(text) || /条/.test(text) || /页/.test(text) || />/.test(text) || /下一页/.test(text)))
                .slice(0, 20)
        };
    });
    console.log(`页面状态: URL=${pageState.url.substring(0, 80)}`);
    console.log(`页面文本长度: ${pageState.bodyTextLength}`);
    console.log(`页面高度: ${pageState.scrollHeight}px, 可视高度: ${pageState.clientHeight}px`);
    console.log(`是否有Bug列表: ${pageState.hasIssueList}`);
    console.log(`当前找到 ${pageState.bugCount} 个Bug`);
    console.log(`滚动容器数: ${pageState.scrollContainers}`);
    console.log(`有加载更多按钮: ${pageState.hasLoadMore}`);
    if (pageState.paginationTexts.length > 0) {
        console.log(`分页相关文本:`);
        pageState.paginationTexts.forEach((text, i) => {
            if (i < 10) console.log(`  ${i + 1}. "${text}"`);
        });
        console.log('');
    } else {
        console.log(`分页相关文本: 无\n`);
    }
    
    // 如果页面内容太少，等待更长时间
    if (pageState.bodyTextLength < 1000) {
        console.log('⚠️ 页面内容较少，等待更多时间加载...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // 再次检查
        const newState = await page.evaluate(() => document.body.innerText.length);
        console.log(`等待后页面文本长度: ${newState}`);
    }
    
    // 检查虚拟列表容器是否存在
    console.log('\n→ 检查虚拟列表容器...');
    const containerCheck = await page.evaluate(() => {
        const gridContainer = document.querySelector('#multi_function_table');
        const reactGrid = document.querySelector('.ReactVirtualized__Grid');
        
        return {
            hasMultiFunctionTable: !!gridContainer,
            hasReactGrid: !!reactGrid,
            multiFunctionTableId: gridContainer ? gridContainer.id : null,
            reactGridClass: reactGrid ? reactGrid.className : null,
            allDivsWithId: Array.from(document.querySelectorAll('div[id]')).map(el => el.id).filter(id => id.includes('multi') || id.includes('table') || id.includes('grid')),
            allDivsWithClass: Array.from(document.querySelectorAll('div[class*="Virtualized"]')).map(el => el.className)
        };
    });
    console.log(`  有 #multi_function_table: ${containerCheck.hasMultiFunctionTable}`);
    console.log(`  有 .ReactVirtualized__Grid: ${containerCheck.hasReactGrid}`);
    if (containerCheck.multiFunctionTableId) {
        console.log(`  ID: ${containerCheck.multiFunctionTableId}`);
    }
    if (containerCheck.reactGridClass) {
        console.log(`  Class: ${containerCheck.reactGridClass.substring(0, 100)}`);
    }
    if (containerCheck.allDivsWithId.length > 0) {
        console.log(`  包含 multi/table/grid 的 div ID:`, containerCheck.allDivsWithId.slice(0, 5));
    }
    if (containerCheck.allDivsWithClass.length > 0) {
        console.log(`  包含 Virtualized 的 div Class:`, containerCheck.allDivsWithClass.slice(0, 3));
    }
    console.log('');
    
    // 使用新的滚动并提取逻辑
    console.log('→ 开始滚动并逐个提取Bug...');
    const bugList = await autoScrollAndExtract(page, dateParam, keyword, projectName);
    
    console.log(`\n✓ 找到 ${bugList.length} 个符合条件的Bug\n`);
    
    // DEBUG模式: 只处理前2个Bug
    const debugMode = false;
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
