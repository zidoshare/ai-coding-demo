# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖（包括 devDependencies 用于构建 CSS）
RUN npm ci

# 复制源代码
COPY . .

# 构建 CSS
RUN npm run build:css

# 生产阶段
FROM node:20-alpine

WORKDIR /app

# 安装 better-sqlite3 需要的编译工具
RUN apk add --no-cache python3 make g++

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --omit=dev && \
    apk del python3 make g++

# 从构建阶段复制构建产物
COPY --from=builder /app/public/css/output.css ./public/css/output.css

# 复制应用代码
COPY app.js ./
COPY db ./db
COPY lib ./lib
COPY views ./views
COPY public ./public

# 创建 apps 目录
RUN mkdir -p apps

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "app.js"]
