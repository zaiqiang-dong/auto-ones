const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function usage() {
    console.log(`
用法:
  node create_lark_doc.js <YYYY-MM-DD> [--title 文档标题] [--dry-run]

示例:
  node create_lark_doc.js 2026-05-17
  node create_lark_doc.js 2026-05-17 --title "2026-05-17 Bug 汇总"
  node create_lark_doc.js 2026-05-17 --dry-run
`);
}

function parseArgs(argv) {
    const result = {
        date: '',
        title: '',
        dryRun: false,
        help: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            result.help = true;
        } else if (arg === '--dry-run') {
            result.dryRun = true;
        } else if (arg === '--title') {
            result.title = argv[++i] || '';
        } else if (!result.date) {
            result.date = arg;
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }

    return result;
}

function validateDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('日期格式不正确，请使用 YYYY-MM-DD，例如 2026-05-17');
    }
}

function readBugFile(date) {
    const filePath = path.join(__dirname, 'extract_bugs', `${date}.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`未找到对应日期的 JSON 文件: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const bugs = JSON.parse(content);

    if (!Array.isArray(bugs)) {
        throw new Error(`JSON 根节点必须是数组: ${filePath}`);
    }

    return { filePath, bugs };
}

function valueOrDash(value) {
    const text = value === null || value === undefined ? '' : String(value).trim();
    return text || '-';
}

function extractProject(title) {
    const match = valueOrDash(title).match(/\[(.*?)\]/);
    return match ? match[1] : '-';
}

function escapeMarkdown(text) {
    return valueOrDash(text)
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>');
}

function quoteForShell(text) {
    return `"${String(text)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\r/g, '')}"`;
}

function buildMarkdown(date, bugs) {
    const title = `${date} Bug 汇总`;
    const createdAt = new Date().toLocaleString('zh-CN', { hour12: false });
    const projectCount = bugs.reduce((map, bug) => {
        const project = extractProject(bug.title);
        map[project] = (map[project] || 0) + 1;
        return map;
    }, {});

    const lines = [
        `# ${title}`,
        '',
        `- 生成时间: ${createdAt}`,
        `- Bug 总数: ${bugs.length}`,
        ''
    ];

    const projects = Object.entries(projectCount).sort((a, b) => b[1] - a[1]);
    if (projects.length > 0) {
        lines.push('## 项目统计', '');
        lines.push('| 项目 | 数量 |');
        lines.push('| --- | ---: |');
        for (const [name, count] of projects) {
            lines.push(`| ${escapeMarkdown(name)} | ${count} |`);
        }
        lines.push('');
    }

    lines.push('## Bug 详情', '');
    bugs.forEach((bug, index) => {
        lines.push(
            `### ${index + 1}. ${escapeMarkdown(bug.id)} ${escapeMarkdown(bug.title)}`,
            '',
            `- Bug ID: ${valueOrDash(bug.id)}`,
            `- 标题: ${valueOrDash(bug.title)}`,
            `- 创建时间: ${valueOrDash(bug.created_at)}`,
            `- 问题时间: ${valueOrDash(bug.issue_time)}`,
            `- VIN: ${valueOrDash(bug.vin)}`,
            `- Build 版本: ${valueOrDash(bug.build_version)}`,
            `- 编译类型: ${valueOrDash(bug.compile_type)}`,
            `- ONES 链接: ${valueOrDash(bug.bug_url)}`,
            `- Log 地址: ${valueOrDash(bug.log_address)}`,
            ''
        );
    });

    return lines.join('\n');
}

function getDmesgFilePath(date, bugId) {
    const bugRoot = path.join(__dirname, 'processed_bugs', date, bugId);

    function walk(dir) {
        if (!fs.existsSync(dir)) {
            return '';
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === 'dmesg_TZ.txt') {
                return fullPath;
            }
            if (entry.isDirectory()) {
                const nested = walk(fullPath);
                if (nested) {
                    return nested;
                }
            }
        }

        return '';
    }

    return walk(bugRoot);
}

function getUefiLogFiles(date, bugId) {
    const bugRoot = path.join(__dirname, 'processed_bugs', date, bugId);
    const uefiLogFiles = [];

    function walk(dir) {
        if (!fs.existsSync(dir)) {
            return;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && /^UefiLog\d+\.txt$/.test(entry.name)) {
                // 提取编号
                const match = entry.name.match(/UefiLog(\d+)\.txt$/);
                if (match) {
                    const number = parseInt(match[1], 10);
                    uefiLogFiles.push({ path: fullPath, number, name: entry.name });
                }
            }
            if (entry.isDirectory()) {
                walk(fullPath);
            }
        }
    }

    walk(bugRoot);

    // 按编号降序排序,取前3个
    uefiLogFiles.sort((a, b) => b.number - a.number);
    return uefiLogFiles.slice(0, 3);
}

function extractDocRef(stdout) {
    const text = String(stdout || '').trim();
    const jsonMatch = text.match(/"url"\s*:\s*"([^"]+)"/i);
    if (jsonMatch) {
        return jsonMatch[1];
    }

    const urlMatch = text.match(/https?:\/\/[^\s"']+/i);
    if (urlMatch) {
        return urlMatch[0];
    }

    const docTokenMatch = text.match(/\b(docx\/[A-Za-z0-9]+|wiki\/[A-Za-z0-9]+)\b/);
    if (docTokenMatch) {
        return docTokenMatch[1];
    }

    return '';
}

function getBugSelection(index, bug) {
    return `${index + 1}. ${valueOrDash(bug.id)} ${valueOrDash(bug.title)}`;
}

function createLarkDoc(title, markdown) {
    return new Promise((resolve, reject) => {
        const args = ['docs', '+create', '--title', title, '--markdown', markdown, '--as', 'user'];
        console.log(
            `执行命令: lark-cli docs +create --title ${quoteForShell(title)} --markdown ${quoteForShell(markdown)} --as user`
        );
        execFile('lark-cli', args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function insertFileIntoDoc(docRef, selection, filePath) {
    return new Promise((resolve, reject) => {
        // 将绝对路径转换为相对于当前工作目录的相对路径
        const relativePath = path.relative(process.cwd(), filePath);
        
        const args = [
            'docs',
            '+media-insert',
            '--doc',
            docRef,
            '--type',
            'file',
            '--file',
            relativePath,
            '--selection-with-ellipsis',
            selection,
            '--as',
            'user'
        ];

        console.log(`插入文件: ${path.basename(filePath)} -> ${selection}`);
        execFile('lark-cli', args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.date) {
        usage();
        if (!args.help && !args.date) {
            process.exitCode = 1;
        }
        return;
    }

    validateDate(args.date);
    const { filePath, bugs } = readBugFile(args.date);
    const title = args.title || `${args.date} Bug 汇总`;
    const markdown = buildMarkdown(args.date, bugs);

    console.log(`读取文件: ${filePath}`);
    console.log(`Bug 数量: ${bugs.length}`);
    console.log(`文档标题: ${title}`);

    if (args.dryRun) {
        console.log('\n========== Markdown 预览 ==========\n');
        console.log(markdown);
        console.log(
            `\n命令预览:\n` +
            `lark-cli docs +create --title ${quoteForShell(title)} --markdown ${quoteForShell(markdown)} --as user`
        );
        console.log('\n后续会按每个 Bug 标题插入对应的 dmesg_TZ.txt 文件。');
        return;
    }

    console.log('正在调用 lark-cli 创建文档...');
    const result = await createLarkDoc(title, markdown);
    const docRef = extractDocRef(result.stdout) || extractDocRef(result.stderr);

    if (result.stdout.trim()) {
        console.log(result.stdout.trim());
    }
    if (result.stderr.trim()) {
        console.error(result.stderr.trim());
    }

    if (!docRef) {
        throw new Error('未能从 lark-cli 创建结果中提取文档引用，无法继续插入 dmesg_TZ.txt');
    }

    console.log(`文档引用: ${docRef}`);
    for (const [index, bug] of bugs.entries()) {
        // 上传 dmesg_TZ.txt
        const dmesgFile = getDmesgFilePath(args.date, bug.id);
        if (dmesgFile) {
            const anchor = getBugSelection(index, bug);
            try {
                await insertFileIntoDoc(docRef, anchor, dmesgFile);
            } catch (error) {
                console.error(`插入失败 ${bug.id} (dmesg_TZ.txt): ${error.message}`);
                if (error.stderr) {
                    console.error(error.stderr.trim());
                }
            }
        } else {
            console.log(`跳过 ${bug.id}: 未找到 dmesg_TZ.txt`);
        }

        // 上传 UefiLog 文件(编号最大的3个)
        const uefiLogFiles = getUefiLogFiles(args.date, bug.id);
        if (uefiLogFiles.length === 0) {
            console.log(`跳过 ${bug.id}: 未找到 UefiLog 文件`);
            continue;
        }

        console.log(`找到 ${uefiLogFiles.length} 个 UefiLog 文件: ${uefiLogFiles.map(f => f.name).join(', ')}`);
        for (const uefiFile of uefiLogFiles) {
            const anchor = getBugSelection(index, bug);
            try {
                await insertFileIntoDoc(docRef, anchor, uefiFile.path);
            } catch (error) {
                console.error(`插入失败 ${bug.id} (${uefiFile.name}): ${error.message}`);
                if (error.stderr) {
                    console.error(error.stderr.trim());
                }
            }
        }
    }

    console.log('飞书文档创建完成');
}

main().catch((error) => {
    console.error(`错误: ${error.message}`);
    if (error.stderr) {
        console.error(error.stderr.trim());
    }
    process.exit(1);
});
