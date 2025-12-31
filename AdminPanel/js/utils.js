// AdminPanel/js/utils.js

/**
 * 显示或隐藏加载覆盖层。
 * @param {boolean} show - 是否显示加载层
 */
export function showLoading(show) {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.toggle('visible', show);
    }
}

/**
 * 显示一个消息弹窗。
 * @param {string} message - 要显示的消息
 * @param {string} [type='info'] - 消息类型 ('info', 'success', 'error')
 * @param {number} [duration=3500] - 显示时长（毫秒）
 */
export function showMessage(message, type = 'info', duration = 3500) {
    const messagePopup = document.getElementById('message-popup');
    if (messagePopup) {
        messagePopup.textContent = message;
        messagePopup.className = 'message-popup'; // Reset classes
        messagePopup.classList.add(type, 'show');
        setTimeout(() => {
            messagePopup.classList.remove('show');
        }, duration);
    }
}

/**
 * 封装的 fetch 请求函数。
 * @param {string} url - 请求的 URL
 * @param {object} [options={}] - fetch 的配置选项
 * @param {boolean} [showLoader=true] - 是否显示加载动画
 * @returns {Promise<any>} - 返回 Promise，解析为 JSON 或文本
 */
export async function apiFetch(url, options = {}, showLoader = true) {
    // 1. 预检：如果不是登录请求且没有认证 Cookie，直接拦截并跳转
    const isLoginRequest = url.includes('/verify-login');
    const hasAuthCookie = document.cookie.split(';').some(item => item.trim().startsWith('admin_auth='));
    
    if (!isLoginRequest && !hasAuthCookie) {
        console.warn('Blocking API fetch due to missing auth cookie:', url);
        window.location.href = '/AdminPanel/login.html';
        return new Promise(() => {}); // 返回一个永远不会 resolve 的 promise，中断后续逻辑
    }

    if (showLoader) showLoading(true);
    try {
        const defaultHeaders = {
            'Content-Type': 'application/json',
        };
        options.headers = { ...defaultHeaders, ...options.headers };
        
        // 确保携带凭据（Cookie）
        if (!options.credentials) {
            options.credentials = 'same-origin';
        }

        const response = await fetch(url, options);
        if (!response.ok) {
            if (response.status === 401) {
                // 2. 响应检查：如果收到 401，说明认证失效
                console.warn('401 Unauthorized detected, redirecting to login...');
                document.cookie = 'admin_auth=; Path=/; Max-Age=0;';
                window.location.href = '/AdminPanel/login.html';
                return new Promise(() => {});
            }
            let errorData = { error: `HTTP error ${response.status}`, details: response.statusText };
            try {
                const jsonError = await response.json();
                errorData = { ...errorData, ...jsonError };
            } catch (e) { /* Ignore if response is not JSON */ }
            throw new Error(errorData.message || errorData.error || errorData.details || `HTTP error ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error('API Fetch Error:', error.message, error);
        showMessage(`操作失败: ${error.message}`, 'error');
        throw error;
    } finally {
        if (showLoader) showLoading(false);
    }
}