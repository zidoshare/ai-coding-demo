const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'app.db');
const db = new Database(dbPath);

// 初始化用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 初始化项目表
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// 创建示例用户
const testUser = db.prepare('SELECT id FROM users WHERE email = ?').get('test@test.com');
if (!testUser) {
  const hashedPassword = bcrypt.hashSync('123456', 10);
  db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run('test@test.com', hashedPassword);
  console.log('示例用户已创建: test@test.com / 123456');
}

module.exports = db;
