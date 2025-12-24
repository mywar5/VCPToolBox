// ==UserScript==
// @name         VCP DailyNote SidePanel
// @namespace    http://tampermonkey.net/
// @version      0.1.8
// @description  在侧边栏嵌入 VCP 日记面板，并将原网页内容向左“顶开”
// @author       B3000Kcn & DBL1F7E5
// @match        http(s)://your.openwebui.url:port/*
// @connect      your.vcptoolbox.url（不含端口）
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置区域 =================
    // ★ 关键修复：末尾手动加上斜杠 '/'，防止 301 重定向丢参数
    const PANEL_URL = "http(s)://your.vcptoolbox.url:port/AdminPanel/DailyNotePanel/";

    // 侧边栏物理宽度
    const PANEL_WIDTH = "260px";

    // ★ 新增：全局缩放比例 (0.1 ~ 2.0)
    // 建议设置 0.8 ~ 0.9，可以让内容显示更紧凑，显示更多文字
    const PANEL_ZOOM = 0.8;

    // ★ 新增：要切掉的侧边栏宽度 (根据截图目测约 64px)
    const SIDEBAR_WIDTH = "51px";

    // ★ 补齐：默认进入的视图 ('stream' | '' | '文件夹名')
    const DEFAULT_VIEW = "stream";

    // 鉴权信息（与 AdminPanel 相同）
    const AUTH_USER = "xxxxxxx";
    const AUTH_PASS = "xxxxxxxxxxxxxxxxxx";
    // ===========================================

    let isPanelOpen = GM_getValue('vcp_panel_open', false);
    let isInnerSidebarHidden = GM_getValue('vcp_inner_sidebar_hidden', true);

    function buildUrl() {
        try {
            const urlObj = new URL(PANEL_URL);
            urlObj.searchParams.delete('sidebar');
            // 修复：确保变量已定义
            if (typeof DEFAULT_VIEW !== 'undefined' && DEFAULT_VIEW) {
                urlObj.searchParams.set('notebook', DEFAULT_VIEW);
            }
            return urlObj.toString();
        } catch (e) { return PANEL_URL; }
    }

    function preAuthAndInit() {
        if (!AUTH_USER || !AUTH_PASS) { init(); return; }
        GM_xmlhttpRequest({
            method: "GET",
            url: PANEL_URL,
            headers: { "Authorization": "Basic " + btoa(AUTH_USER + ":" + AUTH_PASS) },
            onload: () => init(),
            onerror: () => init()
        });
    }

    function init() {
        if (document.getElementById('vcp-side-panel-container')) return;

        GM_addStyle(`
            body, html { transition: margin-right 0.3s ease-in-out; }
            #vcp-side-panel-container {
                position: fixed; top: 0; right: 0;
                width: ${PANEL_WIDTH}; height: 100vh;
                background: #1e1e1e; z-index: 2147483647;
                box-shadow: -5px 0 20px rgba(0,0,0,0.15);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                transform: translateX(100%);
                overflow: hidden;
            }
            #vcp-side-panel-container.active { transform: translateX(0); }

            #vcp-iframe {
                border: none; transform-origin: top left;
                transform: scale(${PANEL_ZOOM});
                height: calc(100% / ${PANEL_ZOOM});
                transition: margin-left 0.3s ease, width 0.3s ease;
                display: block;
            }

            #vcp-toggle-btn {
                position: fixed; bottom: 20px; right: 20px;
                width: 44px; height: 44px;
                background: #333333; color: white; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; z-index: 2147483648;
                /* ★ 修改：去掉了蓝色的发光阴影，改为低调的黑色投影 */
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s;
                font-size: 22px; user-select: none;
            }
            #vcp-toggle-btn:hover {
                transform: scale(1.1);
                background: #ffb46e;
                /* 悬停时稍微亮一点点，或者也可以去掉 */
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            }
            #vcp-toggle-btn.panel-open { right: calc(${PANEL_WIDTH} + 20px); }

            #vcp-sidebar-toggle-btn {
                position: absolute; bottom: 0; left: 0;
                width: 24px; height: 40px;
                background: rgba(0,0,0,0.2); color: #fff;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; z-index: 2147483649;
                font-size: 14px; border-top-right-radius: 8px;
                backdrop-filter: blur(4px);
                transition: background 0.2s, width 0.2s;
            }
            #vcp-sidebar-toggle-btn:hover { background: rgba(37, 99, 235, 0.9); width: 32px; }
        `);

        const container = document.createElement('div');
        container.id = 'vcp-side-panel-container';

        const iframe = document.createElement('iframe');
        iframe.id = 'vcp-iframe';
        iframe.src = buildUrl();
        container.appendChild(iframe);

        const sidebarToggleBtn = document.createElement('div');
        sidebarToggleBtn.id = 'vcp-sidebar-toggle-btn';
        sidebarToggleBtn.innerHTML = '≡';
        sidebarToggleBtn.title = '切换侧边栏';
        sidebarToggleBtn.onclick = toggleInnerSidebar;
        container.appendChild(sidebarToggleBtn);

        document.body.appendChild(container);

        const btn = document.createElement('div');
        btn.id = 'vcp-toggle-btn';
        btn.innerHTML = '📓'; // 小本子图标
        btn.onclick = togglePanel;
        document.body.appendChild(btn);

        updateInnerSidebarState();

        if (isPanelOpen) openPanel();
        GM_registerMenuCommand("切换日记面板", togglePanel);
    }

    function togglePanel() {
        if (isPanelOpen) closePanel(); else openPanel();
    }

    function openPanel() {
        const container = document.getElementById('vcp-side-panel-container');
        const btn = document.getElementById('vcp-toggle-btn');
        if(container && btn) {
            container.classList.add('active');
            btn.classList.add('panel-open');
            document.body.style.marginRight = PANEL_WIDTH;
            isPanelOpen = true;
            GM_setValue('vcp_panel_open', true);
        }
    }

    function closePanel() {
        const container = document.getElementById('vcp-side-panel-container');
        const btn = document.getElementById('vcp-toggle-btn');
        if(container && btn) {
            container.classList.remove('active');
            btn.classList.remove('panel-open');
            document.body.style.marginRight = '0';
            isPanelOpen = false;
            GM_setValue('vcp_panel_open', false);
        }
    }

    function toggleInnerSidebar() {
        isInnerSidebarHidden = !isInnerSidebarHidden;
        updateInnerSidebarState();
        GM_setValue('vcp_inner_sidebar_hidden', isInnerSidebarHidden);
    }

    function updateInnerSidebarState() {
        const iframe = document.getElementById('vcp-iframe');
        const toggleBtn = document.getElementById('vcp-sidebar-toggle-btn');
        if (!iframe) return;

        if (isInnerSidebarHidden) {
            iframe.style.marginLeft = `-${SIDEBAR_WIDTH}`;
            iframe.style.width = `calc((100% + ${SIDEBAR_WIDTH}) / ${PANEL_ZOOM})`;
            toggleBtn.innerHTML = '≡';
        } else {
            iframe.style.marginLeft = '0';
            iframe.style.width = `calc(100% / ${PANEL_ZOOM})`;
            toggleBtn.innerHTML = '✕';
        }
    }

    preAuthAndInit();
})();