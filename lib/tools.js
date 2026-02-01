const { tool } = require('ai');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, '..', 'apps');

/**
 * 验证路径是否安全（防止路径穿越攻击）
 * @param {string} basePath - 基础目录
 * @param {string} userPath - 用户提供的路径
 * @returns {{ safe: boolean, fullPath: string, error?: string }}
 */
function validatePath(basePath, userPath) {
  // 规范化路径
  const normalizedUserPath = path.normalize(userPath);
  
  // 检查是否包含 .. 或以 / 开头（绝对路径）
  if (normalizedUserPath.startsWith('..') || path.isAbsolute(userPath)) {
    return { safe: false, fullPath: '', error: '不允许使用绝对路径或父目录引用' };
  }
  
  // 构建完整路径
  const fullPath = path.resolve(basePath, normalizedUserPath);
  
  // 确保最终路径在基础目录内
  if (!fullPath.startsWith(path.resolve(basePath) + path.sep) && fullPath !== path.resolve(basePath)) {
    return { safe: false, fullPath: '', error: '路径不在允许的目录范围内' };
  }
  
  return { safe: true, fullPath };
}

/**
 * 创建项目目录相关的工具
 */
function createProjectTools(projectId) {
  const projectDir = path.join(APPS_DIR, projectId);

  return {
    // 写入文件工具
    writeFile: tool({
      description: '创建或覆盖写入一个文件到项目目录。用于生成 HTML、CSS、JavaScript 等文件。',
      parameters: z.object({
        path: z.string().describe('相对于项目根目录的文件路径，例如 index.html 或 css/style.css'),
        content: z.string().describe('文件内容'),
      }),
      execute: async ({ path: filePath, content }) => {
        const validation = validatePath(projectDir, filePath);
        if (!validation.safe) {
          return { success: false, error: validation.error };
        }
        
        const fullPath = validation.fullPath;
        const dir = path.dirname(fullPath);
        
        // 确保目录存在
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(fullPath, content, 'utf-8');
        return { success: true, path: filePath, message: `文件 ${filePath} 已创建` };
      },
    }),

    // 读取文件工具
    readFile: tool({
      description: '读取项目目录中的文件内容',
      parameters: z.object({
        filePath: z.string().describe('相对于项目根目录的文件路径'),
      }),
      execute: async ({ filePath }) => {
        const validation = validatePath(projectDir, filePath);
        if (!validation.safe) {
          return { success: false, error: validation.error };
        }
        
        const fullPath = validation.fullPath;
        
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `文件 ${filePath} 不存在` };
        }
        
        const content = fs.readFileSync(fullPath, 'utf-8');
        return { success: true, path: filePath, content };
      },
    }),

    // 列出文件工具
    listFiles: tool({
      description: '列出项目目录中的所有文件',
      parameters: z.object({
        directory: z.string().optional().describe('子目录路径，默认为项目根目录'),
      }),
      execute: async ({ directory = '' }) => {
        const validation = validatePath(projectDir, directory || '.');
        if (!validation.safe) {
          return { success: false, error: validation.error };
        }
        
        const targetDir = validation.fullPath;
        
        if (!fs.existsSync(targetDir)) {
          return { success: false, error: `目录 ${directory || '/'} 不存在` };
        }
        
        const files = [];
        const readDir = (dir, prefix = '') => {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const itemPath = path.join(dir, item);
            const relativePath = prefix ? `${prefix}/${item}` : item;
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              readDir(itemPath, relativePath);
            } else {
              files.push(relativePath);
            }
          }
        };
        
        readDir(targetDir);
        return { success: true, files };
      },
    }),

    // 删除文件工具
    deleteFile: tool({
      description: '删除项目目录中的文件',
      parameters: z.object({
        filePath: z.string().describe('相对于项目根目录的文件路径'),
      }),
      execute: async ({ filePath }) => {
        const validation = validatePath(projectDir, filePath);
        if (!validation.safe) {
          return { success: false, error: validation.error };
        }
        
        const fullPath = validation.fullPath;
        
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `文件 ${filePath} 不存在` };
        }
        
        fs.unlinkSync(fullPath);
        return { success: true, message: `文件 ${filePath} 已删除` };
      },
    }),
  };
}

module.exports = { createProjectTools };
