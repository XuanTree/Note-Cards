// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 定义笔记接口
interface NoteInfo {
    title: string;
    cover?: string;
    filePath: string;
    fileName: string;
    excerpt?: string;
    tags?: string[];
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "note-base-view" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    // const disposable = vscode.commands.registerCommand('note-base-view.helloWorld', () => {
    //     // The code you place here will be executed every time your command is executed
    //     // Display a message box to the user
    //     vscode.window.showInformationMessage('Hello World!');
    // });

    // 注册打开笔记视图的命令
    const openWebViewCommand = vscode.commands.registerCommand('note-base-view.openWebView', async () => {
        // 获取工作区文件夹
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }

        // 显示进度条
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading...',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });

            try {
                // 扫描所有md文件并解析
                const notes = await scanMarkdownFiles(workspaceFolders[0].uri.fsPath);
                
                progress.report({ increment: 100 });

                // 创建并显示Webview面板
                const panel = vscode.window.createWebviewPanel(
                    'noteBaseView', // 标识符
                    `Cards Panel`, // 面板标题
                    vscode.ViewColumn.One, // 在编辑器的哪一列显示
                    {
                        // 启用脚本，允许在webview中使用JavaScript
                        enableScripts: true,
                        // 保留上下文，即使webview不可见也保持状态
                        retainContextWhenHidden: true,
                        // 允许加载外部资源（图片等）
                        localResourceRoots: [
                            vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                            ...vscode.workspace.workspaceFolders?.map(folder => folder.uri) || []
                        ]
                    }
                );

                // 设置HTML内容
                panel.webview.html = getWebviewContent(notes, panel.webview);

                // 处理来自webview的消息
                panel.webview.onDidReceiveMessage(
                    message => {
                        console.log('收到Webview消息:', message);
                        switch (message.command) {
                            case 'openNote':
                                console.log('处理openNote命令，文件路径:', message.filePath);
                                try {
                                    // 打开对应的笔记文件
                                    const noteUri = vscode.Uri.file(message.filePath);
                                    console.log('创建URI成功:', noteUri);
                                    vscode.window.showTextDocument(noteUri).then(
                                        () => console.log('文件打开成功'),
                                        (error) => console.error('文件打开失败:', error)
                                    );
                                } catch (error) {
                                    console.error('处理openNote时出错:', error);
                                    vscode.window.showErrorMessage('打开文件失败: ' + error);
                                }
                                return;
                            case 'alert':
                                vscode.window.showInformationMessage(message.text);
                                return;
                        }
                    },
                    undefined,
                    context.subscriptions
                );

            } catch (error) {
                vscode.window.showErrorMessage('扫描笔记文件时出错: ' + error);
            }
        });
    });

    // context.subscriptions.push(disposable);
    context.subscriptions.push(openWebViewCommand);
}

// 扫描工作区中的所有markdown文件
async function scanMarkdownFiles(workspacePath: string): Promise<NoteInfo[]> {
    const notes: NoteInfo[] = [];
    
    // 递归扫描目录
    async function scanDirectory(dirPath: string) {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    // 递归扫描子目录（排除node_modules等）
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        await scanDirectory(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    // 解析markdown文件
                    const note = await parseMarkdownFile(fullPath);
                    if (note) {
                        notes.push(note);
                    }
                }
            }
        } catch (error) {
            console.error(`扫描目录 ${dirPath} 时出错: `, error);
        }
    }
    
    await scanDirectory(workspacePath);
    return notes.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

// 将Markdown转换为纯文本，去除格式标记
function markdownToPlainText(markdown: string): string {
    if (!markdown) {
        return '';
    }
    
    // 去除Markdown格式标记
    let plainText = markdown
        // 去除标题标记
        .replace(/^#+\s+/gm, '')
        // 去除粗体和斜体标记
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        // 去除代码块标记
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        // 去除链接标记
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // 去除图片标记
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // 去除引用标记
        .replace(/^>\s+/gm, '')
        // 去除水平分割线
        .replace(/^[-*_]{3,}\s*$/gm, '')
        // 去除列表标记
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        // 去除多余的空行
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        //去除表格竖线
        .replace(/\|/g, '')
        // 去除横线
        .replace(/-/g, '')
        // 去除冒号
        .replace(/:/g, '')
        // 去除方括号
        .replace(/\[/g, '')
        .replace(/\]/g, '')
        .trim();
    
    return plainText;
}

// 智能截断文本，避免在单词中间截断
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    
    // 在最大长度附近找到最近的空格位置进行截断
    const truncated = text.slice(0, maxLength);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    
    if (lastSpaceIndex > maxLength * 0.8) {
        return truncated.slice(0, lastSpaceIndex) + '...';
    }
    
    return truncated + '...';
}

// 解析markdown文件，提取yaml frontmatter
async function parseMarkdownFile(filePath: string): Promise<NoteInfo | null> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const fileName = path.basename(filePath, '.md');
        const fileDir = path.dirname(filePath);
        
        // 简单的yaml frontmatter解析
        console.log('开始解析文件:', filePath);
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        let cover: string | undefined;
        let title = fileName; // 默认使用文件名作为标题
        let tags: string[] = [];
        
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            console.log('提取到frontmatter内容:', frontmatter);
            
            // 解析Cover字段（不区分大小写）
            const coverMatch = frontmatter.match(/^Cover:\s*(.+)$/mi);
            if (coverMatch) {
                cover = coverMatch[1].trim();
                console.log(`解析到Cover字段: "${cover}"`);
                
                // 检查是否是本地相对路径（不是网络URL）
                if (cover && !cover.match(/^https?:\/\//) && !cover.match(/^data:/)) {
                    // 如果是相对路径，转换为绝对路径
                    const absolutePath = path.resolve(fileDir, cover);
                    console.log(`将相对路径 "${cover}" 转换为绝对路径: "${absolutePath}"`);
                    cover = absolutePath;
                }
            } else {
                console.log('未找到Cover字段，frontmatter内容:', frontmatter);
                // 尝试更宽松的匹配
                const relaxedMatch = frontmatter.match(/Cover:\s*([^\n\r]+)/i);
                if (relaxedMatch) {
                    cover = relaxedMatch[1].trim();
                    console.log(`使用宽松匹配解析到Cover字段: "${cover}"`);
                    
                    // 检查是否是本地相对路径（不是网络URL）
                    if (cover && !cover.match(/^https?:\/\//) && !cover.match(/^data:/)) {
                        // 如果是相对路径，转换为绝对路径
                        const absolutePath = path.resolve(fileDir, cover);
                        console.log(`将相对路径 "${cover}" 转换为绝对路径: "${absolutePath}"`);
                        cover = absolutePath;
                    }
                } else {
                    console.log('宽松匹配也失败，尝试逐行解析');
                    // 逐行解析frontmatter
                    const lines = frontmatter.split('\n');
                    for (const line of lines) {
                        if (line.toLowerCase().startsWith('cover:')) {
                            cover = line.substring(6).trim();
                            console.log(`逐行解析到Cover字段: "${cover}"`);
                            
                            // 检查是否是本地相对路径（不是网络URL）
                            if (cover && !cover.match(/^https?:\/\//) && !cover.match(/^data:/)) {
                                // 如果是相对路径，转换为绝对路径
                                const absolutePath = path.resolve(fileDir, cover);
                                console.log(`将相对路径 "${cover}" 转换为绝对路径: "${absolutePath}"`);
                                cover = absolutePath;
                            }
                            break;
                        }
                    }
                }
            }
            
            // 解析Title字段（不区分大小写）
            const titleMatch = frontmatter.match(/^Title:\s*(.+)$/mi);
            if (titleMatch) {
                title = titleMatch[1].trim();
            }
            
            // 解析Tags字段（不区分大小写）
            const tagsMatch = frontmatter.match(/^Tags:\s*(.+)$/mi);
            if (tagsMatch) {
                tags = tagsMatch[1].split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            }
        }
        
        // 提取内容并转换为纯文本
        const contentWithoutFrontmatter = frontmatterMatch 
            ? content.slice(frontmatterMatch[0].length).trim()
            : content.trim();
        
        // 将Markdown转换为纯文本并智能截断
        const plainText = markdownToPlainText(contentWithoutFrontmatter);
        const excerpt = truncateText(plainText, 120) || '暂无内容摘要';
        
        return {
            title,
            cover,
            filePath,
            fileName,
            excerpt,
            tags
        };
    } catch (error) {
        console.error(`解析文件 ${filePath} 时出错: `, error);
        return null;
    }
}

// 获取Webview的HTML内容
function getWebviewContent(notes: NoteInfo[], webview: vscode.Webview): string {
    // 获取所有唯一的标签
    const allTags = Array.from(new Set(notes.flatMap(note => note.tags || []))).sort();
    
    // 生成标签筛选器HTML
    const tagsFilterHtml = `
        <div class="tags-filter">
            <div class="filter-label" id="filter-label">🏷️ Tags:</div>
            <div class="tags-container">
                <button class="tag-btn active" data-tag="all">🌐 All</button>
                ${allTags.map(tag => `<button class="tag-btn" data-tag="${tag}">${tag}</button>`).join('')}
            </div>
        </div>
    `;

    // 生成笔记卡片HTML（包含标签显示）
    const notesHtml = notes.map(note => {
        const noteTags = note.tags || [];
        const noteTagsString = noteTags.length > 0 ? noteTags.join(',') : 'none';
        
        // 调试日志
        console.log(`生成笔记卡片: ${note.title}, cover: ${note.cover}`);
        
        // 处理封面图片URL
        let coverHtml = '';
        if (note.cover) {
            let coverSrc = note.cover;
            
            // 检查是否是本地文件路径（不是网络URL）
            if (!note.cover.match(/^https?:\/\//) && !note.cover.match(/^data:/)) {
                try {
                    // 将本地文件路径转换为Webview可访问的URI
                    const coverUri = webview.asWebviewUri(vscode.Uri.file(note.cover));
                    coverSrc = coverUri.toString();
                    console.log(`将本地路径 "${note.cover}" 转换为Webview URI: "${coverSrc}"`);
                    coverHtml = `<div class="note-cover"><img src="${coverSrc}" alt="封面图片" /></div>`;
                } catch (error) {
                    console.error(`转换封面图片URI失败: ${error}`);
                    coverHtml = '<div class="note-cover">封面图片路径无效</div>';
                }
            } else {
                // 如果是网络URL或data URL，直接使用
                coverHtml = `<div class="note-cover"><img src="${coverSrc}" alt="封面图片" /></div>`;
            }
        }
        
        return `
        <div class="note-card" data-file-path="${note.filePath}" data-tags="${noteTagsString}">
            ${coverHtml}
            <div class="note-content">
                <div class="note-header">
                    <div class="note-title">${note.title}</div>
                    <div class="note-filename">${note.fileName}.md</div>
                </div>
                <div class="note-excerpt">${note.excerpt || '暂无内容摘要'}</div>
                ${noteTags.length > 0 ? `<div class="note-tags">${noteTags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
            </div>
            <div class="note-actions">
                <button class="open-btn" data-file-path="${note.filePath}" title="Open Note">📄</button>
            </div>
        </div>
        `;
    }).join('');

    // 生成nonce用于CSP
    const nonce = Math.random().toString(36).substring(2);
    
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>📋 Note Cards</title>
        <style>
            :root {
                --bg-primary: #f5f5f5;
                --bg-secondary: #ffffff;
                --text-primary: #333333;
                --text-secondary: #666666;
                --text-muted: #999999;
                --border-color: #e0e0e0;
                --accent-color: #369;
                --accent-hover: #258;
                --shadow-light: rgba(0, 0, 0, 0.1);
                --shadow-medium: rgba(0, 0, 0, 0.15);
                --tag-bg: #e3f2fd;
                --tag-text: #1976d2;
                --tag-hover: #bbdefb;
                --filter-bg: #f8f9fa;
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --bg-primary: #1e1e1e;
                    --bg-secondary: #2d2d2d;
                    --text-primary: #ffffff;
                    --text-secondary: #cccccc;
                    --text-muted: #888888;
                    --border-color: #444444;
                    --accent-color: #4a90e2;
                    --accent-hover: #357abd;
                    --shadow-light: rgba(0, 0, 0, 0.3);
                    --shadow-medium: rgba(0, 0, 0, 0.4);
                    --tag-bg: #2a4365;
                    --tag-text: #90cdf4;
                    --tag-hover: #2c5282;
                    --filter-bg: #2d3748;
                }
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                color: var(--text-primary);
                background-color: var(--bg-primary);
                transition: background-color 0.3s, color 0.3s;
            }
            
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
                padding-bottom: 15px;
                border-bottom: 2px solid var(--border-color);
            }
            
            .header-controls {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .theme-toggle {
                display: flex;
                align-items: center;
            }
            
            .theme-btn {
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 50%;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 18px;
            }
            
            .theme-btn:hover {
                background: var(--accent-color);
                color: white;
                transform: scale(1.1);
            }
            
            /* 手动主题切换类 */
            .theme-light {
                --bg-primary: #f5f5f5;
                --bg-secondary: #ffffff;
                --text-primary: #333333;
                --text-secondary: #666666;
                --text-muted: #999999;
                --border-color: #e0e0e0;
                --accent-color: #369;
                --accent-hover: #258;
                --shadow-light: rgba(0, 0, 0, 0.1);
                --shadow-medium: rgba(0, 0, 0, 0.15);
                --tag-bg: #e3f2fd;
                --tag-text: #1976d2;
                --tag-hover: #bbdefb;
                --filter-bg: #f8f9fa;
            }
            
            .theme-dark {
                --bg-primary: #1e1e1e;
                --bg-secondary: #2d2d2d;
                --text-primary: #ffffff;
                --text-secondary: #cccccc;
                --text-muted: #888888;
                --border-color: #444444;
                --accent-color: #4a90e2;
                --accent-hover: #357abd;
                --shadow-light: rgba(0, 0, 0, 0.3);
                --shadow-medium: rgba(0, 0, 0, 0.4);
                --tag-bg: #2a4365;
                --tag-text: #90cdf4;
                --tag-hover: #2c5282;
                --filter-bg: #2d3748;
            }
            
            h1 {
                color: var(--accent-color);
                margin: 0;
                font-size: 24px;
            }
            
            .notes-count {
                color: var(--text-secondary);
                font-size: 14px;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                color: var(--text-primary);
                background-color: var(--bg-primary);
                transition: background-color 0.3s, color 0.3s;
                min-width: 100%;
                box-sizing: border-box;
            }
            
            .notes-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 24px;
                justify-content: flex-start;
                align-items: stretch;
                width: 100%;
                margin: 0;
                padding: 0;
            }
            
            .note-card {
                background-color: var(--bg-secondary);
                border-radius: 8px;
                padding: 20px;
                box-shadow: 0 2px 8px var(--shadow-light);
                transition: transform 0.2s, box-shadow 0.2s, background-color 0.3s;
                border: 1px solid var(--border-color);
                flex: 0 0 calc(33.333% - 16px);
                box-sizing: border-box;
                min-width: 280px;
                min-height: 280px;
                margin: 0;
                position: relative;
                z-index: 1;
                display: flex;
                flex-direction: column;
            }
            
            .note-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 16px var(--shadow-medium);
                z-index: 2;
            }
            
            .note-content {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            
            .note-excerpt {
                flex: 1;
                color: var(--text-secondary);
                line-height: 1.5;
                margin-bottom: 15px;
                font-size: 0.95em;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
            }
            
            /* 响应式布局 */
            @media (min-width: 1200px) {
                .note-card {
                    flex: 0 0 calc(25% - 18px);
                    max-width: calc(25% - 18px);
                }
            }
            
            @media (min-width: 800px) and (max-width: 1199px) {
                .note-card {
                    flex: 0 0 calc(33.333% - 16px);
                    max-width: calc(33.333% - 16px);
                }
            }
            
            @media (min-width: 600px) and (max-width: 799px) {
                .note-card {
                    flex: 0 0 calc(50% - 12px);
                    max-width: calc(50% - 12px);
                }
            }
            
            @media (max-width: 599px) {
                .note-card {
                    flex: 0 0 100%;
                    max-width: 100%;
                }
            }
            
            .note-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 16px var(--shadow-medium);
            }
            
            .note-cover {
                margin-bottom: 15px;
                text-align: center;
                min-height: 100px;
                background-color: var(--bg-secondary);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .note-cover img {
                max-width: 100%;
                max-height: 200px;
                border-radius: 4px;
                object-fit: contain;
            }
            
            .note-header {
                margin-bottom: 10px;
            }
            
            .note-title {
                font-weight: bold;
                font-size: 1.2em;
                color: var(--text-primary);
                margin-bottom: 5px;
                line-height: 1.3;
            }
            
            .note-filename {
                font-size: 0.9em;
                color: var(--text-secondary);
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            }
            
            .note-excerpt {
                color: var(--text-secondary);
                line-height: 1.5;
                margin-bottom: 15px;
                font-size: 0.95em;
            }
            
            .note-actions {
                text-align: right;
            }
            
            .open-btn {
                background-color: var(--accent-color);
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.9em;
                transition: background-color 0.2s;
            }
            
            .open-btn:hover {
                background-color: var(--accent-hover);
            }
            
            .empty-state {
                text-align: center;
                color: var(--text-muted);
                padding: 60px 20px;
                grid-column: 1 / -1;
            }
            
            .empty-state h3 {
                margin-bottom: 10px;
                color: var(--text-muted);
            }
            
            .empty-state p {
                color: var(--text-secondary);
            }

            /* 标签筛选器样式 */
            .tags-filter {
                background-color: var(--filter-bg);
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 20px;
                border: 1px solid var(--border-color);
            }

            .filter-label {
                font-weight: bold;
                margin-bottom: 10px;
                color: var(--text-primary);
            }

            .tags-container {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            .tag-btn {
                background-color: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 6px 12px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                color: var(--text-secondary);
            }

            .tag-btn:hover {
                background-color: var(--accent-color);
                color: white;
                border-color: var(--accent-color);
            }

            .tag-btn.active {
                background-color: var(--accent-color);
                color: white;
                border-color: var(--accent-color);
            }

            /* 笔记标签样式 */
            .note-tags {
                margin-bottom: 15px;
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
            }

            .tag {
                background-color: var(--tag-bg);
                color: var(--tag-text);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
            }

            /* 主题切换动画 */
            * {
                transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1 id="page-title">📖 Note Cards</h1>
            <div class="header-controls">
                <div class="notes-count" id="notes-count">📝 ${notes.length}</div>
                <div class="theme-toggle">
                    <button id="theme-toggle-btn" class="theme-btn" title="切换主题">
                        <span class="theme-icon">🌙</span>
                    </button>
                </div>
            </div>
        </div>
        
        ${notes.length > 0 ? `
            ${tagsFilterHtml}
            <div class="notes-grid" id="notes-grid">
                ${notesHtml}
            </div>
        ` : `
            <div class="empty-state">
                <h3 id="no-notes-title">未找到笔记文件</h3>
                <p id="no-notes-desc">在工作区中未找到任何 .md 文件，请确保工作区包含markdown笔记文件。</p>
            </div>
        `}

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            console.log('Webview脚本开始执行');
            console.log('acquireVsCodeApi完成:', vscode);
            
            function openNote(filePath) {
                console.log('openNote函数被调用，文件路径:', filePath);
                try {
                    vscode.postMessage({
                        command: 'openNote',
                        filePath: filePath
                    });
                    console.log('postMessage调用成功');
                } catch (error) {
                    console.error('postMessage调用失败:', error);
                }
            }

            // 添加事件监听器
            document.addEventListener('DOMContentLoaded', function() {
                console.log('DOM加载完成');
                
                // 为所有打开笔记按钮添加点击事件
                document.addEventListener('click', function(event) {
                    if (event.target.classList.contains('open-btn')) {
                        console.log('打开笔记按钮被点击');
                        const filePath = event.target.getAttribute('data-file-path');
                        console.log('获取文件路径:', filePath);
                        if (filePath) {
                            openNote(filePath);
                        } else {
                            console.error('未找到文件路径属性');
                        }
                    }
                });

                // 检测主题变化
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                console.log('当前主题:', mediaQuery.matches ? '暗色' : '亮色');
                
                // 主题切换功能
                const themeToggleBtn = document.getElementById('theme-toggle-btn');
                const themeIcon = themeToggleBtn.querySelector('.theme-icon');
                
                // 获取保存的主题偏好
                let savedTheme = localStorage.getItem('note-view-theme');
                const systemIsDark = mediaQuery.matches;
                
                // 初始化主题
                function initTheme() {
                    let currentTheme = savedTheme;
                    
                    // 如果没有保存的主题偏好，使用系统主题
                    if (!currentTheme) {
                        currentTheme = systemIsDark ? 'dark' : 'light';
                    }
                    
                    applyTheme(currentTheme);
                    updateThemeIcon(currentTheme);
                }
                
                // 应用主题
                function applyTheme(theme) {
                    document.body.classList.remove('theme-light', 'theme-dark');
                    document.body.classList.add('theme-' + theme);
                    localStorage.setItem('note-view-theme', theme);
                    savedTheme = theme; // 更新保存的主题变量
                }
                
                // 更新主题图标
                function updateThemeIcon(theme) {
                    themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
                    themeToggleBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
                }
                
                // 切换主题
                function toggleTheme() {
                    const currentTheme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    
                    applyTheme(newTheme);
                    updateThemeIcon(newTheme);
                    console.log('主题切换至:', newTheme);
                }
                
                // 监听主题切换按钮点击
                themeToggleBtn.addEventListener('click', toggleTheme);
                
                // 监听系统主题变化（仅在未手动设置主题时生效）
                mediaQuery.addEventListener('change', (e) => {
                    // 只有当用户没有手动设置主题偏好时，才跟随系统主题
                    if (!savedTheme) {
                        const newTheme = e.matches ? 'dark' : 'light';
                        applyTheme(newTheme);
                        updateThemeIcon(newTheme);
                        console.log('跟随系统主题变化:', newTheme);
                    }
                });
                
                // 标签筛选功能
                function initTagFilter() {
                    // 移除之前的事件监听器
                    const oldButtons = document.querySelectorAll('.tag-btn');
                    oldButtons.forEach(button => {
                        button.replaceWith(button.cloneNode(true));
                    });
                    
                    const tagButtons = document.querySelectorAll('.tag-btn');
                    const noteCards = document.querySelectorAll('.note-card');
                    
                    tagButtons.forEach(button => {
                        button.addEventListener('click', function() {
                            // 移除所有按钮的active类
                            tagButtons.forEach(btn => btn.classList.remove('active'));
                            // 为当前按钮添加active类
                            this.classList.add('active');
                            
                            const selectedTag = this.getAttribute('data-tag');
                            
                            // 筛选笔记卡片
                            noteCards.forEach(card => {
                                if (selectedTag === 'all') {
                                    card.style.display = 'flex';
                                } else {
                                    const cardTagsAttr = card.getAttribute('data-tags');
                                    const cardTags = cardTagsAttr === 'none' ? [] : cardTagsAttr.split(',');
                                    if (cardTags.includes(selectedTag)) {
                                        card.style.display = 'flex';
                                    } else {
                                        card.style.display = 'none';
                                    }
                                }
                            });
                            
                            // 更新笔记数量显示
                            const visibleNotes = Array.from(noteCards).filter(card => card.style.display !== 'none').length;
                            const totalNotes = noteCards.length;
                            const notesCountEl = document.getElementById('notes-count');
                            
                            notesCountEl.textContent = selectedTag === 'all' ? \`📝 \${totalNotes}\` : \`📝 \${visibleNotes}/\${totalNotes}\`;
                            
                            console.log('筛选标签:', selectedTag, '显示笔记:', visibleNotes);
                        });
                    });
                }
                
                // 初始化标签筛选
                if (document.querySelector('.tags-filter')) {
                    initTagFilter();
                }
                
                // 初始化主题
                initTheme();
            });
        </script>
    </body>
    </html>`;
}
// This method is called when your extension is deactivated
export function deactivate() {}