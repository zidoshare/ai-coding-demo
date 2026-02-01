require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { streamText, stepCountIs } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const db = require('./db');
const { createProjectTools } = require('./lib/tools');

// 使用智谱 AI 的 OpenAI 兼容接口
const zhipu = createOpenAI({
  apiKey: process.env.ZHIPU_API_KEY,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
  compatibility: 'strict', // 使用标准 OpenAI chat completions API
});

const app = express();
const PORT = process.env.PORT || 3000;
const APPS_DIR = path.join(__dirname, 'apps');

// 确保 apps 目录存在
if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}

// 泛域名静态文件服务中间件
app.use((req, res, next) => {
  const host = req.hostname;
  // 匹配 {projectId}.localhost 格式（支持字母数字）
  const match = host.match(/^([a-z0-9]+)\.localhost$/i);

  if (match) {
    const projectId = match[1];
    const projectDir = path.join(APPS_DIR, projectId);
    
    // 检查项目目录是否存在
    if (fs.existsSync(projectDir)) {
      // 使用 static 中间件，如果文件不存在则返回 404
      return express.static(projectDir)(req, res, () => {
        res.status(404).send('文件不存在');
      });
    } else {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>项目未就绪</title></head>
        <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #94a3b8;">
          <div style="text-align: center;">
            <h1 style="color: #e2e8f0;">项目构建中...</h1>
            <p>项目 ${projectId} 正在生成，请稍候</p>
          </div>
        </body>
        </html>
      `);
    }
  }
  
  next();
});

// 设置 EJS 为模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 中间件
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'vibe-coding-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 认证中间件
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
};

// 首页路由（需要登录）
app.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  res.render('index', { title: 'Vibe Coding Platform', user });
});

// 注册页面
app.get('/register', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('register', { title: 'Vibe Coding Platform', error: null });
});

// 注册处理
app.post('/register', (req, res) => {
  const { email, password, confirmPassword } = req.body;
  
  // 验证
  if (!email || !password || !confirmPassword) {
    return res.render('register', { title: 'Vibe Coding Platform', error: '请填写所有字段' });
  }
  
  if (password !== confirmPassword) {
    return res.render('register', { title: 'Vibe Coding Platform', error: '两次密码输入不一致' });
  }
  
  if (password.length < 6) {
    return res.render('register', { title: 'Vibe Coding Platform', error: '密码至少需要6位' });
  }
  
  // 检查邮箱是否已存在
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.render('register', { title: 'Vibe Coding Platform', error: '该邮箱已被注册' });
  }
  
  // 加密密码并保存
  const hashedPassword = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hashedPassword);
    res.redirect('/login?registered=1');
  } catch (err) {
    res.render('register', { title: 'Vibe Coding Platform', error: '注册失败，请重试' });
  }
});

// 登录页面
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  const success = req.query.registered ? '注册成功，请登录' : null;
  res.render('login', { title: 'Vibe Coding Platform', error: null, success });
});

// 登录处理
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.render('login', { title: 'Vibe Coding Platform', error: '请填写邮箱和密码', success: null });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { title: 'Vibe Coding Platform', error: '邮箱或密码错误', success: null });
  }
  
  req.session.userId = user.id;
  res.redirect('/');
});

// 登出
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 生成项目 ID
function generateProjectId() {
  return crypto.randomBytes(8).toString('hex');
}

// 创建项目
app.post('/projects', requireAuth, (req, res) => {
  const projectId = generateProjectId();
  const { prompt } = req.body;
  // 从 prompt 中提取项目名称（取前20个字符）
  const name = prompt ? prompt.substring(0, 50) : '未命名项目';
  
  try {
    db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)').run(
      projectId,
      req.session.userId,
      name
    );
    res.json({ id: projectId });
  } catch (err) {
    res.status(500).json({ error: '创建项目失败' });
  }
});

// 获取项目列表
app.get('/api/projects', requireAuth, (req, res) => {
  try {
    const projects = db.prepare(
      'SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(req.session.userId);
    res.json(projects);
  } catch (err) {
    console.error('获取项目列表失败:', err);
    res.status(500).json({ error: '获取项目列表失败' });
  }
});

// 项目详情页
app.get('/projects/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(
    req.params.id,
    req.session.userId
  );
  
  if (!project) {
    return res.status(404).send('项目不存在');
  }
  
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  res.render('project', { title: 'Vibe Coding Platform', user, project });
});

// AI 聊天 API (SSE 流式响应)
app.post('/api/chat/:projectId', requireAuth, async (req, res) => {
  const { projectId } = req.params;
  const { messages } = req.body;

  // 验证项目归属
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(
    projectId,
    req.session.userId
  );

  if (!project) {
    return res.status(404).json({ error: '项目不存在' });
  }

  // 确保项目目录存在
  const projectDir = path.join(APPS_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const tools = createProjectTools(projectId);
    
    console.log('Tools available:', Object.keys(tools));

    const result = streamText({
      model: zhipu.chat('glm-4.7'),
      system: `你是一个专业的前端开发助手，帮助用户创建 Web 应用。

你的任务是根据用户的需求，生成完整的前端代码（HTML、CSS、JavaScript）。

重要规则：
1. 直接使用 writeFile 工具创建文件，不要先调用 listFiles
2. 生成的应用必须是纯前端的，可以直接在浏览器中运行
3. 主入口文件必须是 index.html
4. 可以创建多个文件来组织代码（如 css/style.css, js/app.js）
5. 使用现代的 CSS 和 JavaScript，确保代码美观且功能完整
6. 开发完成后，告诉用户可以在右侧预览效果
7. 你的回复务必简短，不要超过 5 行，不要使用 emoji
8. 花时间思考你的设计，朴素简单，不要使用俗套的渐变。
`,
      messages,
      tools,
      stopWhen: stepCountIs(20),
      onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
        console.log('Step finished:', { finishReason, hasToolCalls: !!toolCalls?.length, hasToolResults: !!toolResults?.length });
        // 发送工具调用结果
        if (toolResults && toolResults.length > 0) {
          for (const result of toolResults) {
            res.write(`data: ${JSON.stringify({ type: 'tool-result', result })}\n\n`);
          }
        }
      },
    });

    // 使用 fullStream 来确保工具被执行
    for await (const part of result.fullStream) {
      // 调试：打印所有事件类型
      if (!['text-delta'].includes(part.type)) {
        console.log('Stream event:', part.type, JSON.stringify(part, null, 2));
      }
      
      switch (part.type) {
        case 'text-delta':
          if (part.text) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`);
          }
          break;
        case 'tool-call':
          console.log('Tool call full:', JSON.stringify(part, null, 2));
          res.write(`data: ${JSON.stringify({ 
            type: 'tool-call',
            toolCallId: part.toolCallId,
            tool: part.toolName, 
            args: part.input || part.args
          })}\n\n`);
          break;
        case 'tool-result':
          console.log('Tool result full:', JSON.stringify(part, null, 2));
          res.write(`data: ${JSON.stringify({ 
            type: 'tool-result',
            toolCallId: part.toolCallId,
            tool: part.toolName, 
            result: part.output || part.result
          })}\n\n`);
          break;
        case 'finish':
          console.log('Finish reason:', part.finishReason);
          break;
        case 'error':
          console.error('Stream error:', part.error);
          break;
      }
    }

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('AI Chat Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
