// =================================================================================
//  项目: nanobanana-2api (Cloudflare Worker 单文件版)
//  版本: 1.1.0 (代号: Ghost Banana - IP Spoofing Edition)
//  作者: 首席AI执行官 (Principal AI Executive Officer)
//  协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
//  日期: 2025-11-26
//
//  [v1.1.0 核心升级]
//  1. [IP 伪装]: 每次请求生成随机住宅 IP 并注入 X-Forwarded-For 等头部，绕过 IP 频次限制。
//  2. [智能重试]: 遇到 "Device used" 错误时，自动更换身份重试 (Max 3次)。
//  3. [指纹增强]: 升级指纹生成算法，模拟真实浏览器特征。
//  4. [Web UI]: 包含实时调试面板，可看到伪造的 IP 和指纹信息。
// =================================================================================

// --- [第一部分: 核心配置] ---
const CONFIG = {
  PROJECT_NAME: "nanobanana-2api",
  PROJECT_VERSION: "1.1.0",
  
  // 安全配置
  API_MASTER_KEY: "1", 
  
  // 上游服务配置
  UPSTREAM_ORIGIN: "https://nanobananaai.org",
  SUBMIT_ENDPOINT: "https://nanobananaai.org/api/gen-text-to-image",
  
  // 模型列表
  MODELS: [
    "nano-banana-v1"
  ],
  DEFAULT_MODEL: "nano-banana-v1",

  // 风格映射
  STYLES: [
    { id: 0, name: "No Style (原图)", value: "no-style" },
    { id: 1, name: "3D Cute (3D可爱)", value: "3d-cute" },
    { id: 9, name: "Ghibli (吉卜力)", value: "ghibli" },
    { id: 11, name: "Anime (动漫)", value: "anime" },
    { id: 12, name: "Pixel Art (像素风)", value: "pixel-art" },
    { id: 13, name: "Disney (迪士尼)", value: "disney" },
    { id: 14, name: "Pixar (皮克斯)", value: "pixar" },
    { id: 15, name: "Realistic (写实)", value: "realistic" },
    { id: 7, name: "Emoji Stickers (表情包)", value: "chibi-emoji" },
    { id: 3, name: "Instax (拍立得)", value: "instax" }
  ],

  // 策略配置
  MAX_RETRIES: 3, // 遇到限制时最大重试次数
  POLLING_INTERVAL: 2000,
  POLLING_TIMEOUT: 60000,
};

// --- [第二部分: Worker 入口] ---
export default {
  async fetch(request, env, ctx) {
    const apiKey = env.API_MASTER_KEY || CONFIG.API_MASTER_KEY;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleCorsPreflight();
    if (url.pathname === '/') return handleUI(request, apiKey);
    if (url.pathname.startsWith('/v1/')) return handleApi(request, apiKey);
    
    return createErrorResponse(`Path not found: ${url.pathname}`, 404, 'not_found');
  }
};

// --- [第三部分: 核心业务逻辑 (Ghost Identity Protocol)] ---

/**
 * 生成随机 IPv4 地址 (排除局域网段)
 * 用于伪造 X-Forwarded-For，欺骗上游的 IP 限制
 */
function generateRandomIP() {
  const part1 = Math.floor(Math.random() * 223) + 1; // 1-223
  const part2 = Math.floor(Math.random() * 256);
  const part3 = Math.floor(Math.random() * 256);
  const part4 = Math.floor(Math.random() * 256);
  
  // 简单排除私有网段 (10.x, 192.168.x, 172.16-31.x)
  if (part1 === 10) return generateRandomIP();
  if (part1 === 192 && part2 === 168) return generateRandomIP();
  if (part1 === 172 && (part2 >= 16 && part2 <= 31)) return generateRandomIP();
  
  return `${part1}.${part2}.${part3}.${part4}`;
}

/**
 * 生成 32位 Hex 指纹
 */
function generateFingerprint() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 构造伪装请求头 (包含 IP 欺骗)
 */
function getHeaders(fingerprint, fakeIP) {
  return {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": CONFIG.UPSTREAM_ORIGIN,
    "referer": `${CONFIG.UPSTREAM_ORIGIN}/?utm_source=agenthunter&utm_medium=referral`,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "x-fingerprint-id": fingerprint,
    "priority": "u=1, i",
    
    // --- IP 欺骗矩阵 ---
    "X-Forwarded-For": fakeIP,
    "X-Real-IP": fakeIP,
    "Client-IP": fakeIP,
    "True-Client-IP": fakeIP,
    "X-Client-IP": fakeIP,
    "CF-Connecting-IP": fakeIP // 尝试覆盖 CF IP (虽然 Worker 内部通常不允许，但值得一试)
  };
}

/**
 * 执行生成任务 (带自动重试机制)
 */
async function performGeneration(prompt, aspectRatio, styleId, imageCount = 1) {
  let lastError = null;

  // 自动重试循环
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    const fingerprint = generateFingerprint();
    const fakeIP = generateRandomIP();
    const headers = getHeaders(fingerprint, fakeIP);
    
    // 构造 Prompt (注入风格)
    const styleObj = CONFIG.STYLES.find(s => s.id == styleId);
    let finalPrompt = prompt;
    if (styleObj && styleObj.value !== 'no-style') {
        finalPrompt = `${prompt}, ${styleObj.name} style`;
    }

    // 构造 Payload
    const payload = {
      prompt: finalPrompt,
      aspectRatio: aspectRatio || "1:1",
      imageCount: imageCount,
      fingerprintId: fingerprint
    };

    console.log(`[Attempt ${attempt}] IP: ${fakeIP}, FP: ${fingerprint}`);

    try {
      // 1. 提交任务
      const submitResp = await fetch(CONFIG.SUBMIT_ENDPOINT, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!submitResp.ok) {
        throw new Error(`HTTP ${submitResp.status}`);
      }

      const submitData = await submitResp.json();

      // 检查业务错误码
      if (submitData.code === -1) {
        // 命中风控，抛出特定错误以触发重试
        console.warn(`[Attempt ${attempt}] Blocked: ${submitData.message}`);
        lastError = new Error(`IP/Device Blocked: ${submitData.message}`);
        continue; // 重试下一轮
      }

      if (submitData.code !== 0 || !submitData.data?.taskId) {
        throw new Error(`API Error: ${JSON.stringify(submitData)}`);
      }

      const taskId = submitData.data.taskId;
      
      // 2. 轮询状态 (如果提交成功，进入轮询)
      return await pollTask(taskId, fingerprint, headers);

    } catch (e) {
      lastError = e;
      // 如果不是风控错误（例如网络超时），可能不需要重试，但为了稳健我们继续
      await new Promise(r => setTimeout(r, 1000)); // 冷却 1 秒
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * 轮询任务状态
 */
async function pollTask(taskId, fingerprint, headers) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < CONFIG.POLLING_TIMEOUT) {
    await new Promise(r => setTimeout(r, CONFIG.POLLING_INTERVAL));
    
    const pollUrl = `${CONFIG.SUBMIT_ENDPOINT}?taskId=${taskId}&fingerprintId=${fingerprint}`;
    const pollResp = await fetch(pollUrl, {
      method: "GET",
      headers: headers
    });

    if (!pollResp.ok) continue;

    const pollData = await pollResp.json();
    const task = pollData.data?.task;

    if (!task) continue;

    if (task.status === 'completed') {
      let images = [];
      if (task.image_url) images.push(task.image_url);
      if (task.image_urls) {
        try {
          const parsed = typeof task.image_urls === 'string' ? JSON.parse(task.image_urls) : task.image_urls;
          if (Array.isArray(parsed)) images = parsed;
        } catch (e) {}
      }
      return [...new Set(images)];
    } else if (task.status === 'failed') {
      throw new Error(`Generation Failed: ${task.result || 'Unknown error'}`);
    }
  }
  throw new Error("Polling timeout");
}

// --- [第四部分: API 处理器] ---

async function handleApi(request, apiKey) {
  const authHeader = request.headers.get('Authorization');
  if (apiKey && apiKey !== "1") {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return createErrorResponse('Unauthorized', 401, 'unauthorized');
    if (authHeader.substring(7) !== apiKey) return createErrorResponse('Invalid Key', 403, 'invalid_api_key');
  }

  const url = new URL(request.url);
  const requestId = `req-${crypto.randomUUID()}`;

  if (url.pathname === '/v1/models') return handleModelsRequest();
  if (url.pathname === '/v1/chat/completions') return handleChatCompletions(request, requestId);
  if (url.pathname === '/v1/images/generations') return handleImageGenerations(request, requestId);
  
  return createErrorResponse('Not Found', 404, 'not_found');
}

function handleModelsRequest() {
  return new Response(JSON.stringify({
    object: 'list',
    data: CONFIG.MODELS.map(id => ({ id, object: 'model', created: Date.now(), owned_by: 'nanobanana' }))
  }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

async function handleChatCompletions(request, requestId) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    const lastMsg = messages.reverse().find(m => m.role === 'user');
    if (!lastMsg) throw new Error("No user message found");

    const prompt = lastMsg.content;
    
    // 参数提取
    let aspectRatio = "1:1";
    let cleanPrompt = prompt;
    const arMatch = prompt.match(/--ar\s+(\d+:\d+)/);
    if (arMatch) {
      aspectRatio = arMatch[1];
      cleanPrompt = prompt.replace(arMatch[0], "").trim();
    }

    // 执行生成 (默认风格 0: No Style)
    const images = await performGeneration(cleanPrompt, aspectRatio, 0, 1);
    const imageUrl = images[0];
    const markdown = `![Generated Image](${imageUrl})\n\n[下载原图](${imageUrl})`;

    // 流式响应模拟
    if (body.stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        const chunk = {
          id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000),
          model: body.model || CONFIG.DEFAULT_MODEL,
          choices: [{ index: 0, delta: { content: markdown }, finish_reason: null }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        
        const endChunk = {
          id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000),
          model: body.model || CONFIG.DEFAULT_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        await writer.close();
      })();

      return new Response(readable, { headers: corsHeaders({ 'Content-Type': 'text/event-stream' }) });
    } else {
      return new Response(JSON.stringify({
        id: requestId, object: "chat.completion", created: Math.floor(Date.now()/1000),
        model: body.model || CONFIG.DEFAULT_MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: markdown }, finish_reason: "stop" }]
      }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
    }
  } catch (e) {
    return createErrorResponse(e.message, 500, 'generation_failed');
  }
}

async function handleImageGenerations(request, requestId) {
  try {
    const body = await request.json();
    const prompt = body.prompt;
    const n = body.n || 1;
    const size = body.size || "1024x1024";
    
    let aspectRatio = "1:1";
    if (size === "1024x1792") aspectRatio = "9:16";
    if (size === "1792x1024") aspectRatio = "16:9";

    const images = await performGeneration(prompt, aspectRatio, 0, n);
    
    return new Response(JSON.stringify({
      created: Math.floor(Date.now() / 1000),
      data: images.map(url => ({ url: url }))
    }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
  } catch (e) {
    return createErrorResponse(e.message, 500, 'generation_failed');
  }
}

// --- 辅助函数 ---
function createErrorResponse(message, status, code) {
  return new Response(JSON.stringify({ error: { message, type: 'api_error', code } }), {
    status, headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}
function handleCorsPreflight() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function corsHeaders(headers = {}) {
  return { ...headers, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}

// --- [第五部分: 开发者驾驶舱 UI] ---
function handleUI(request, apiKey) {
  const origin = new URL(request.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.PROJECT_NAME} - 驾驶舱</title>
    <style>
      :root { --bg: #121212; --panel: #1E1E1E; --border: #333; --text: #E0E0E0; --primary: #FFBF00; --accent: #007AFF; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; height: 100vh; display: flex; overflow: hidden; }
      .sidebar { width: 380px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
      .main { flex: 1; display: flex; flex-direction: column; padding: 20px; }
      .box { background: #252525; padding: 12px; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 15px; }
      .label { font-size: 12px; color: #888; margin-bottom: 5px; display: block; }
      .code-block { font-family: monospace; font-size: 12px; color: var(--primary); word-break: break-all; background: #111; padding: 8px; border-radius: 4px; cursor: pointer; }
      input, select, textarea { width: 100%; background: #333; border: 1px solid #444; color: #fff; padding: 8px; border-radius: 4px; margin-bottom: 10px; box-sizing: border-box; }
      button { width: 100%; padding: 10px; background: var(--primary); border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: #000; }
      button:disabled { background: #555; cursor: not-allowed; }
      .chat-window { flex: 1; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; }
      .msg { max-width: 80%; padding: 10px 15px; border-radius: 8px; line-height: 1.5; }
      .msg.user { align-self: flex-end; background: #333; color: #fff; }
      .msg.ai { align-self: flex-start; background: #1a1a1a; border: 1px solid #333; width: 100%; max-width: 100%; }
      .msg.ai img { max-width: 100%; border-radius: 4px; margin-top: 10px; display: block; }
      .log-panel { height: 150px; background: #111; border-top: 1px solid var(--border); padding: 10px; font-family: monospace; font-size: 11px; color: #aaa; overflow-y: auto; }
      .log-entry { margin-bottom: 4px; border-bottom: 1px solid #222; padding-bottom: 2px; }
      .log-time { color: #555; margin-right: 5px; }
      .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #888; border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 5px; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2 style="margin-top:0">🍌 ${CONFIG.PROJECT_NAME} <span style="font-size:12px;color:#888">v${CONFIG.PROJECT_VERSION}</span></h2>
        <div class="box"><span class="label">API 密钥</span><div class="code-block" onclick="copy('${apiKey}')">${apiKey}</div></div>
        <div class="box"><span class="label">API 接口</span><div class="code-block" onclick="copy('${origin}/v1/chat/completions')">${origin}/v1/chat/completions</div></div>
        <div class="box">
            <span class="label">模型</span>
            <select id="model">${CONFIG.MODELS.map(m => `<option value="${m}">${m}</option>`).join('')}</select>
            <span class="label">风格</span>
            <select id="style">${CONFIG.STYLES.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
            <span class="label">比例</span>
            <select id="ratio"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select>
            <span class="label" style="margin-top:10px">提示词</span>
            <textarea id="prompt" rows="4" placeholder="描述你想生成的图片..."></textarea>
            <button id="btn-gen" onclick="generate()">生成图片</button>
        </div>
    </div>
    <main class="main">
        <div class="chat-window" id="chat">
            <div style="color:#666; text-align:center; margin-top:50px;">
                NanoBanana 代理服务就绪。<br>
                已启用 Ghost Identity Protocol (IP伪装 + 自动重试)。
            </div>
        </div>
        <div class="log-panel" id="logs"><div class="log-entry">系统初始化完成...</div></div>
    </main>
    <script>
        const API_KEY = "${apiKey}";
        const ENDPOINT = "${origin}/v1/images/generations";
        function copy(text) { navigator.clipboard.writeText(text); alert('已复制'); }
        function log(msg) {
            const div = document.createElement('div'); div.className = 'log-entry';
            div.innerHTML = \`<span class="log-time">[\${new Date().toLocaleTimeString()}]</span> \${msg}\`;
            const panel = document.getElementById('logs'); panel.appendChild(div); panel.scrollTop = panel.scrollHeight;
        }
        function appendMsg(role, html) {
            const div = document.createElement('div'); div.className = \`msg \${role}\`; div.innerHTML = html;
            document.getElementById('chat').appendChild(div); div.scrollIntoView({ behavior: "smooth" }); return div;
        }
        async function generate() {
            const prompt = document.getElementById('prompt').value.trim();
            if (!prompt) return alert('请输入提示词');
            const btn = document.getElementById('btn-gen'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 生成中...';
            if(document.querySelector('.chat-window').innerText.includes('代理服务就绪')) document.getElementById('chat').innerHTML = '';
            appendMsg('user', prompt);
            const loadingMsg = appendMsg('ai', '<span class="spinner"></span> 正在请求 NanoBanana (可能触发重试)...');
            const styleSelect = document.getElementById('style');
            const styleName = styleSelect.options[styleSelect.selectedIndex].text;
            const finalPrompt = styleSelect.value !== 'no-style' ? \`\${prompt}, \${styleName} style\` : prompt;
            log(\`开始任务: \${finalPrompt}\`);
            try {
                const res = await fetch(ENDPOINT, {
                    method: 'POST', headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: document.getElementById('model').value,
                        prompt: finalPrompt,
                        size: document.getElementById('ratio').value === '1:1' ? '1024x1024' : (document.getElementById('ratio').value === '16:9' ? '1792x1024' : '1024x1792'),
                        n: 1
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error?.message || '生成失败');
                const url = data.data[0].url;
                log(\`生成成功: \${url}\`);
                loadingMsg.innerHTML = \`<div><strong>生成成功</strong> <span style="font-size:12px;color:#888">(\${styleName})</span></div><img src="\${url}" alt="Generated Image"><div style="margin-top:10px"><a href="\${url}" target="_blank" style="color:var(--primary)">在新标签页打开</a></div>\`;
            } catch (e) {
                log(\`错误: \${e.message}\`);
                loadingMsg.innerHTML = \`<span style="color:#CF6679">❌ 错误: \${e.message}</span>\`;
            } finally {
                btn.disabled = false; btn.innerText = "生成图片";
            }
        }
    </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
