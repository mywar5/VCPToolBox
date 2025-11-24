// ==UserScript==
// @name           OpenWebUI VCP Tool Call Display Enhancer
// @version        2.0.0
// @description    Uses a global "Pending Set" to track unfinished tool calls. Any stream update anywhere on the page triggers a check on pending items, ensuring previous blocks render immediately upon completion.
// @author         B3000Kcn
// @match          https://your.openwebui.url/*
// @run-at         document-idle
// @grant          GM_addStyle
// @license        MIT
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. 样式配置
    // ==========================================
    function addStyle(css) {
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    const CARD_CLASS = "vcp-tool-card";
    const HIDDEN_CLASS = "vcp-display-none";

    const CSS_RULES = `
        /* 原始节点：彻底隐藏，不占空间 */
        .${HIDDEN_CLASS} {
            display: none !important;
        }

        /* 卡片容器 */
        .${CARD_CLASS} {
            all: initial;
            display: block;
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
            border: 1px solid #e5e7eb;
            border-radius: 4px;
            margin: 4px 0 !important;
            overflow: hidden;
            background-color: #ffffff;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            width: 100%;
            box-sizing: border-box;
            position: relative;
            z-index: 1;
        }
        .dark .${CARD_CLASS} {
            background-color: #1a1a1a;
            border-color: #333;
        }

        /* 标题栏 */
        .${CARD_CLASS} .vcp-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 2px 8px !important;
            background-color: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
            height: 26px;
            min-height: 26px;
            box-sizing: border-box;
        }
        .dark .${CARD_CLASS} .vcp-header {
            background-color: #262626;
            border-color: #333;
        }
        .${CARD_CLASS} .vcp-title {
            font-size: 0.75rem;
            font-weight: 600;
            color: #6b7280;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .dark .${CARD_CLASS} .vcp-title { color: #9ca3af; }

        /* 按钮 */
        .${CARD_CLASS} .vcp-btn {
            padding: 0 6px;
            height: 18px;
            font-size: 0.65rem;
            border-radius: 2px;
            border: 1px solid #d1d5db;
            background: white;
            cursor: pointer;
            color: #4b5563;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .dark .${CARD_CLASS} .vcp-btn {
            background: #000;
            border-color: #444;
            color: #aaa;
        }
        .${CARD_CLASS} .vcp-btn:hover { background: #f3f4f6; color: #000; }
        .dark .${CARD_CLASS} .vcp-btn:hover { background: #333; color: #fff; }

        /* 内容区 */
        .${CARD_CLASS} .vcp-body {
            display: block;
            padding: 0 !important;
            margin: 0 !important;
            background-color: #fdfdfd;
        }
        .dark .${CARD_CLASS} .vcp-body {
            background-color: #0d0d0d;
        }

        /* 代码块：核心 pre-wrap */
        .${CARD_CLASS} .vcp-code {
            display: block !important;
            padding: 4px 8px !important;
            margin: 0 !important;
            background-color: transparent !important;
            font-family: "Menlo", "Monaco", "Consolas", monospace !important;
            font-size: 0.75rem !important;
            line-height: 1.35 !important;
            color: #1f2937 !important;
            overflow-x: auto;
            white-space: pre-wrap !important;
            word-break: break-all;
            border: none !important;
        }
        .dark .${CARD_CLASS} .vcp-code { color: #d1d5db !important; }

        /* 运行中状态 */
        .${CARD_CLASS} .vcp-status-running {
            font-style: italic;
            color: #9ca3af;
            padding: 8px;
        }
    `;

    // ==========================================
    // 2. 常量与全局状态
    // ==========================================
    const START_MARKER = "<<<[TOOL_REQUEST]>>>";
    const END_MARKER = "<<<[END_TOOL_REQUEST]>>>";

    // 关键：全局待办列表
    // 只要卡片还没渲染完，就一直留在这里
    const pendingStates = new Set();
    // 辅助 Map 防止重复创建
    const processedElements = new WeakMap();

    // ==========================================
    // 3. 核心：HTML 格式解析
    // ==========================================
    function extractTextFromHTML(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        const brs = temp.querySelectorAll('br');
        brs.forEach(br => br.replaceWith('\n'));

        const blocks = temp.querySelectorAll('div, p, tr, li');
        blocks.forEach(blk => {
            blk.after(document.createTextNode('\n'));
        });

        return temp.textContent;
    }

    function parseToolName(text) {
        const match = text.match(/tool_name:\s*「始」(.*?)「末」/);
        return match ? match[1].trim() : "Processing...";
    }

    // ==========================================
    // 4. UI 构建
    // ==========================================
    function createCardDOM() {
        const container = document.createElement('div');
        container.className = CARD_CLASS;
        container.innerHTML = `
            <div class="vcp-header">
                <div class="vcp-title">
                    <span style="font-size:1.1em; line-height:1; margin-right:4px;">⚙️</span>
                    <span class="vcp-name-text">Tool Call</span>
                </div>
                <div>
                    <button class="vcp-btn copy-btn" style="display:none">Copy</button>
                </div>
            </div>
            <div class="vcp-body">
                <div class="vcp-code vcp-status-running">Running...</div>
            </div>
        `;
        return {
            container,
            titleText: container.querySelector('.vcp-name-text'),
            codeBlock: container.querySelector('.vcp-code'),
            copyBtn: container.querySelector('.copy-btn')
        };
    }

    // ==========================================
    // 5. 逻辑：检查与渲染
    // ==========================================

    function checkAndRenderState(state) {
        // 1. 快速检查结束标记 (textContent 在 display:none 下依然有效)
        const rawTextContent = state.targetParent.textContent || "";

        // 如果没有结束标记，直接返回，继续留在 pending 列表里
        if (!rawTextContent.includes(END_MARKER)) return false;

        // --- 结束标记检测到，开始渲染 ---

        // 2. 解析 HTML 获取格式化文本
        const rawHTML = state.targetParent.innerHTML;
        const fullFormattedText = extractTextFromHTML(rawHTML);

        // 3. 提取内容
        let cleanContent = fullFormattedText;
        const sIdx = fullFormattedText.indexOf(START_MARKER);
        const eIdx = fullFormattedText.lastIndexOf(END_MARKER);

        if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
            cleanContent = fullFormattedText.substring(sIdx + START_MARKER.length, eIdx);
        }

        cleanContent = cleanContent.trim();

        // 4. 更新 UI
        const toolName = parseToolName(fullFormattedText);
        state.dom.titleText.textContent = `VCP Tool Call: ${toolName}`;

        state.dom.codeBlock.classList.remove('vcp-status-running');
        state.dom.codeBlock.textContent = cleanContent;
        state.dom.copyBtn.style.display = 'inline-flex';

        // 5. 绑定复制
        state.dom.copyBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(cleanContent);
                const originalText = state.dom.copyBtn.textContent;
                state.dom.copyBtn.textContent = 'Copied';
                state.dom.copyBtn.disabled = true;
                setTimeout(() => {
                    if (state.dom.copyBtn.isConnected) {
                        state.dom.copyBtn.textContent = originalText;
                        state.dom.copyBtn.disabled = false;
                    }
                }, 2000);
            } catch (err) {}
        };

        // 返回 true 表示渲染完成，可以从待办列表中移除
        return true;
    }

    function processTarget(parent) {
        if (!parent.isConnected) return;
        // 如果已经处理过
        if (processedElements.has(parent)) return;

        // 黑名单与防吞噬
        const tag = parent.tagName;
        if (['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE'].includes(tag)) return;
        if (parent.classList.contains(CARD_CLASS)) return;

        const hasBlockChildren = Array.from(parent.children).some(child => {
            if (child.classList.contains(CARD_CLASS)) return false;
            return ['DIV', 'P', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE'].includes(child.tagName);
        });
        if (hasBlockChildren) return;

        // 初始化拦截
        if (!parent.textContent.includes(START_MARKER)) return;

        // 1. 创建卡片
        const dom = createCardDOM();

        // 2. 插入卡片
        parent.parentNode.insertBefore(dom.container, parent);

        // 3. 隐藏原始节点
        parent.classList.add(HIDDEN_CLASS);

        // 4. 创建状态
        const state = {
            dom: dom,
            targetParent: parent
        };

        processedElements.set(parent, state);
        pendingStates.add(state); // 加入待办列表！

        // 5. 立即检查一次
        if (checkAndRenderState(state)) {
            pendingStates.delete(state);
        }
    }

    // ==========================================
    // 6. 全局监听 (事件驱动 + 待办检查)
    // ==========================================
    function init() {
        console.log('OpenWebUI VCP Enhancer (v36.0.0 Pending-List) Activated');
        addStyle(CSS_RULES);

        const observer = new MutationObserver(mutations => {
            // 1. 每次 DOM 变动，首先检查待办列表 (Pending List)
            // 借用其他节点的更新事件，来触发对“旧”卡片的检查
            if (pendingStates.size > 0) {
                pendingStates.forEach(state => {
                    // 如果渲染成功，从未完成列表中移除
                    if (checkAndRenderState(state)) {
                        pendingStates.delete(state);
                    }
                });
            }

            // 2. 寻找新的目标 (标准流程)
            const parentsToCheck = new Set();
            for (const m of mutations) {
                if (m.type === 'characterData') {
                    if (m.target.parentNode) parentsToCheck.add(m.target.parentNode);
                }
                else if (m.type === 'childList') {
                    parentsToCheck.add(m.target);
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === Node.TEXT_NODE && n.nodeValue.includes(START_MARKER)) {
                            if (n.parentNode) parentsToCheck.add(n.parentNode);
                        }
                        else if (n.nodeType === Node.ELEMENT_NODE) {
                            if (n.textContent.includes(START_MARKER)) {
                                const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, null, false);
                                let tn;
                                while (tn = walker.nextNode()) {
                                    if (tn.nodeValue.includes(START_MARKER)) {
                                        if (tn.parentNode) parentsToCheck.add(tn.parentNode);
                                    }
                                }
                            }
                        }
                    });
                }
            }

            parentsToCheck.forEach(p => {
                if (p && p.nodeType === Node.ELEMENT_NODE) processTarget(p);
            });
        });

        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        // 初始扫描
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let tn;
        while (tn = walker.nextNode()) {
            if (tn.nodeValue.includes(START_MARKER)) {
                if (tn.parentNode) processTarget(tn.parentNode);
            }
        }
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init, { once: true });
    }

})();
