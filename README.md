# Snap Roast Buddy

一个“图片 -> 图片描述 -> 排版三分类 -> AI 评价 -> 58mm 热敏纸排版预览”的前后端 demo。

## 当前生成流程

```txt
1. 上传图片或选择示例图片
   -> 后端调用视觉模型 Pro/moonshotai/Kimi-K2.6
   -> 得到中文图片描述

2. 使用图片描述进行三分类
   -> 后端调用文本模型
   -> 分类到 receipt / big_text / pixel_expression

3. 生成有趣评价并排版
   -> 后端生成 AI 评价
   -> 前端使用 packages/layout 生成小票 SVG 预览
```

也可以跳过图片上传，直接编辑文字描述再生成。

## 项目结构

```txt
frontend/
  index.html          # 主网页
  debug.html          # 调试面板
  styles.css
  src/app.ts          # 主页面交互
  src/debug.ts        # 调试页面交互
  dist/               # 构建后的浏览器脚本

backend/
  server.mjs          # 静态服务 + API 代理

packages/layout/
  src/                # 照片分析、排版选择、内容生成、SVG/文本渲染

config/layout-skills/
  *.md / *.json       # 可替换的排版规则 skill

hardware/esp32/
  README.md           # 后续 ESP32 / 打印机接入说明
```

## 启动

```bash
npm install
npm run build:frontend
npm run dev
```

打开：

```txt
http://localhost:5173
```

调试面板：

```txt
http://localhost:5173/debug.html
```

## API 配置

复制 `.env.example` 为 `.env`，填入 SiliconFlow API key：

```env
SILICONFLOW_API_KEY=YOUR_API_KEY
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Pro/zai-org/GLM-4.7
SILICONFLOW_VISION_MODEL=Pro/moonshotai/Kimi-K2.6
```

浏览器不会直接持有 API key。前端请求后端，后端再调用模型。

## 部署到 Vercel

项目已经包含 `vercel.json` 和 `api/` serverless functions。

Vercel 项目设置建议：

```txt
Build Command: npm run build:frontend
Output Directory: frontend
Install Command: npm install
```

需要在 Vercel Environment Variables 里配置：

```env
SILICONFLOW_API_KEY=YOUR_API_KEY
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Pro/zai-org/GLM-4.7
SILICONFLOW_VISION_MODEL=Pro/moonshotai/Kimi-K2.6
```

线上接口：

```txt
/api/analyze-image
/api/classify-layout
/api/roast
/api/debug/prompts
/api/debug/skills
```

## 后端接口

```txt
POST /api/analyze-image
POST /api/classify-layout
POST /api/roast
GET  /api/debug/prompts
GET  /api/debug/skills
```

## 常用命令

```bash
npm run check
npm run build:frontend
npm run demo
npm run dev
```

## 后续硬件接入方向

- `POST /api/print`：接收 layout JSON 或 bitmap。
- ESC/POS 转换：把 `LayoutDocument` 转成热敏打印机位图数据。
- ESP32 通信：通过 HTTP、WebSocket、BLE 或串口转发打印任务。
- 打印队列：缓存失败任务，支持重试和状态回传。
