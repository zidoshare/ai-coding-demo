const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 设置 EJS 为模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 首页路由
app.get('/', (req, res) => {
  res.render('index', { title: 'Vibe Coding Platform' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
