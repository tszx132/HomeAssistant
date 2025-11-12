// Home Assistant 应用配置
const HA_CONFIG = {
    // 默认配置
    DEFAULT_URL: 'http://homeassistant.local:8123',
    
    // 浏览器设置
    BROWSER_OPTIONS: {
        location: 'yes',
        toolbar: 'yes',
        zoom: 'yes',
        hardwareback: 'yes',
        clearcache: 'no',
        clearsessioncache: 'no',
        closebuttoncaption: '关闭',
        disallowoverscroll: 'yes',
        hidenavigationbuttons: 'no',
        hideurlbar: 'no',
        fullscreen: 'no'
    },
    
    // 连接超时（毫秒）
    CONNECTION_TIMEOUT: 10000,
    
    // 重试次数
    MAX_RETRIES: 3
};

// 全局变量
let currentBrowser = null;
let connectionTimer = null;
let retryCount = 0;
let currentHaUrl = '';

// 设备就绪事件
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    console.log('Cordova 设备就绪，准备连接 Home Assistant');
    
    // 设置状态栏
    if (window.StatusBar) {
        StatusBar.overlaysWebView(false);
        StatusBar.backgroundColorByHexString('#121212');
        StatusBar.styleLightContent();
    }
    
    // 加载保存的配置
    loadSavedConfig();
    
    // 设置网络监听
    setupNetworkListeners();
    
    // 设置返回按钮
    setupBackButton();
}

// 加载保存的配置
function loadSavedConfig() {
    const savedUrl = localStorage.getItem('ha_url');
    const savedToken = localStorage.getItem('ha_token');
    
    if (savedUrl) {
        document.getElementById('haUrl').value = savedUrl;
    }
    
    if (savedToken) {
        document.getElementById('haToken').value = savedToken;
    }
}

// 保存配置
function saveConfig(url, token) {
    localStorage.setItem('ha_url', url);
    if (token) {
        localStorage.setItem('ha_token', token);
    }
}

// 连接到 Home Assistant
function connectToHomeAssistant() {
    const urlInput = document.getElementById('haUrl');
    const tokenInput = document.getElementById('haToken');
    
    let haUrl = urlInput.value.trim();
    const haToken = tokenInput.value.trim();
    
    if (!haUrl) {
        showError('请输入 Home Assistant 地址', '请填写有效的 URL 地址');
        return;
    }
    
    // 格式化 URL
    haUrl = formatHomeAssistantUrl(haUrl);
    currentHaUrl = haUrl;
    
    // 保存配置
    saveConfig(haUrl, haToken);
    
    // 显示加载界面
    showLoading();
    updateLoadingText('正在验证连接...');
    
    // 设置连接超时
    connectionTimer = setTimeout(() => {
        handleConnectionError('连接超时', '无法在指定时间内连接到 Home Assistant 实例');
    }, HA_CONFIG.CONNECTION_TIMEOUT);
    
    // 测试连接并打开
    testAndOpenConnection(haUrl, haToken);
}

// 格式化 Home Assistant URL
function formatHomeAssistantUrl(url) {
    // 移除首尾空格
    url = url.trim();
    
    // 如果没有协议，添加 http://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        // 对于本地地址，默认使用 http
        if (url.includes('.local') || url.includes('192.168.') || url.includes('10.0.') || url.includes('172.16.')) {
            url = 'http://' + url;
        } else {
            url = 'https://' + url;
        }
    }
    
    // 确保有端口（如果没有的话）
    if (!url.includes(':') && !url.endsWith('/')) {
        url += ':8123';
    } else if (!url.includes(':') && url.endsWith('/')) {
        url = url.slice(0, -1) + ':8123/';
    }
    
    return url;
}

// 测试连接并打开
function testAndOpenConnection(url, token) {
    updateLoadingText('正在连接到: ' + getDisplayUrl(url));
    
    // 首先测试连接
    testConnection(url, token)
        .then(() => {
            // 连接成功，打开浏览器
            clearTimeout(connectionTimer);
            openHomeAssistant(url, token);
        })
        .catch(error => {
            // 连接测试失败，但仍然尝试打开（可能是 CORS 问题）
            console.warn('连接测试失败，但仍尝试打开:', error);
            clearTimeout(connectionTimer);
            openHomeAssistant(url, token);
        });
}

// 测试连接
function testConnection(url, token) {
    return new Promise((resolve, reject) => {
        const testUrl = url + (url.endsWith('/') ? '' : '/') + 'api/';
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        
        // 简单的连接测试
        const xhr = new XMLHttpRequest();
        xhr.timeout = 5000;
        xhr.open('GET', testUrl, true);
        
        // 设置请求头
        Object.keys(headers).forEach(key => {
            xhr.setRequestHeader(key, headers[key]);
        });
        
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('网络错误'));
        };
        
        xhr.ontimeout = function() {
            reject(new Error('请求超时'));
        };
        
        xhr.send();
    });
}

// 打开 Home Assistant
function openHomeAssistant(url, token) {
    updateLoadingText('正在启动 Home Assistant...');
    
    try {
        // 构建最终 URL（如果提供了 token）
        let finalUrl = url;
        if (token) {
            // 使用 token 参数方式（如果 Home Assistant 支持）
            finalUrl = url + (url.endsWith('/') ? '' : '/') + '?auth_callback=1';
        }
        
        // 打开 InAppBrowser
        currentBrowser = cordova.InAppBrowser.open(
            finalUrl,
            '_blank',
            Object.keys(HA_CONFIG.BROWSER_OPTIONS)
                .map(key => `${key}=${HA_CONFIG.BROWSER_OPTIONS[key]}`)
                .join(',')
        );
        
        // 设置浏览器事件
        setupBrowserEvents(currentBrowser, token);
        
    } catch (error) {
        console.error('打开浏览器失败:', error);
        handleConnectionError('启动失败', '无法打开浏览器: ' + error.message);
    }
}

// 设置浏览器事件
function setupBrowserEvents(browser, token) {
    if (!browser) return;
    
    browser.addEventListener('loadstart', function(event) {
        console.log('开始加载:', event.url);
        updateLoadingText('正在加载界面...');
        
        // 如果提供了 token，可以尝试自动注入
        if (token && event.url.includes('/auth/authorize')) {
            // 这里可以处理认证流程
            console.log('检测到认证页面，token:', token ? '已提供' : '未提供');
        }
    });
    
    browser.addEventListener('loadstop', function(event) {
        console.log('加载完成:', event.url);
        hideLoading();
        showStatusBar('已连接到 Home Assistant');
        
        // 隐藏状态栏 after 3 seconds
        setTimeout(() => {
            hideStatusBar();
        }, 3000);
    });
    
    browser.addEventListener('loaderror', function(event) {
        console.error('加载错误:', event.message);
        handleConnectionError('加载失败', event.message || '未知错误');
    });
    
    browser.addEventListener('exit', function(event) {
        console.log('浏览器已关闭');
        currentBrowser = null;
        hideStatusBar();
        showConfig();
    });
}

// 快速连接设置
function setQuickUrl(url) {
    document.getElementById('haUrl').value = url;
}

// 网络状态监听
function setupNetworkListeners() {
    if (navigator.connection) {
        document.addEventListener('online', function() {
            console.log('网络连接恢复');
            showStatusBar('网络连接已恢复');
            setTimeout(hideStatusBar, 3000);
        });
        
        document.addEventListener('offline', function() {
            console.log('网络连接断开');
            showStatusBar('网络连接已断开');
        });
    }
}

// 返回按钮处理
function setupBackButton() {
    document.addEventListener('backbutton', function(e) {
        e.preventDefault();
        
        if (currentBrowser) {
            // 在浏览器中执行返回操作
            currentBrowser.executeScript({
                code: `
                    if (window.history.length > 1) {
                        window.history.back();
                        true;
                    } else {
                        false;
                    }
                `
            }, function(result) {
                if (result && result[0] === false) {
                    // 如果不能返回，关闭浏览器
                    currentBrowser.close();
                }
            });
        } else if (!isConfigVisible()) {
            // 显示配置界面
            showConfig();
        } else {
            // 退出应用确认
            if (confirm('确定要退出 Home Assistant 吗？')) {
                navigator.app.exitApp();
            }
        }
    }, false);
}

// UI 控制函数
function showConfig() {
    document.getElementById('configContainer').style.display = 'flex';
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('errorContainer').style.display = 'none';
    hideStatusBar();
    retryCount = 0;
}

function showLoading() {
    document.getElementById('configContainer').style.display = 'none';
    document.getElementById('loadingContainer').style.display = 'flex';
    document.getElementById('errorContainer').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loadingContainer').style.display = 'none';
}

function showError(title, message, details = '') {
    clearTimeout(connectionTimer);
    
    document.getElementById('configContainer').style.display = 'none';
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('errorContainer').style.display = 'flex';
    
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorDetails').textContent = details;
    
    showStatusBar(title + ': ' + message);
}

function updateLoadingText(text) {
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
        loadingText.textContent = text;
    }
}

function showStatusBar(message) {
    const statusBar = document.getElementById('statusBar');
    statusBar.textContent = message;
    statusBar.style.display = 'block';
}

function hideStatusBar() {
    document.getElementById('statusBar').style.display = 'none';
}

function isConfigVisible() {
    return document.getElementById('configContainer').style.display === 'flex';
}

// 错误处理
function handleConnectionError(title, message) {
    retryCount++;
    
    if (retryCount < HA_CONFIG.MAX_RETRIES) {
        showError(title, message + ` (重试 ${retryCount}/${HA_CONFIG.MAX_RETRIES})`);
        setTimeout(() => {
            retryConnection();
        }, 2000);
    } else {
        showError(title, message + ' - 已超过最大重试次数');
    }
}

// 重试连接
function retryConnection() {
    if (currentHaUrl) {
        connectToHomeAssistant();
    } else {
        showConfig();
    }
}

// 工具函数
function getDisplayUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname + (urlObj.port ? ':' + urlObj.port : '');
    } catch {
        return url;
    }
}

// 自动连接（如果之前成功过）
function autoConnect() {
    const savedUrl = localStorage.getItem('ha_url');
    if (savedUrl) {
        document.getElementById('haUrl').value = savedUrl;
        // 可选：自动连接
        // connectToHomeAssistant();
    }
}

// 初始化自动连接
autoConnect();