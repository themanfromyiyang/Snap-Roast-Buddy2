# Snap Roast Buddy

一个“拍照/选图 -> AI 评价 -> 热敏纸结果”的前后端 demo。项目包含工程测试页、调试页，以及更接近真实移动端产品的 `Snap Roast Buddy` 相机式界面。

## 当前生成流程

```txt
产品页流程：

1. 点击快门选择图片
   -> 后端调用视觉模型 Pro/moonshotai/Kimi-K2.6
   -> 得到中文图片描述

2. 选择生成模式
   -> 自动：图片分析、排版选择、内容生成
   -> 小票 / 爆字 / 表情：图片分析、内容生成

3. 生成有趣评价并排版
   -> 后端生成 AI 评价
   -> 前端使用 packages/layout 生成小票 SVG 预览

4. 可选漫画
   -> 开启漫画后，后端调用图像编辑模型 Qwen/Qwen-Image-Edit-2509
   -> 漫画生成会和图片分析/内容生成流程并行，最后合并到结果

5. 本地保存
   -> 生成记录会写入 local-data/snap-roast-records.json
   -> 左下角相册入口可查看历史结果，支持左右切换和删除
```

测试页仍支持直接编辑图片描述并生成排版。产品页面向真实移动端体验。

## 项目结构

```txt
frontend/
  index.html          # 主网页
  product.html        # 移动端产品模式
  debug.html          # 调试面板
  styles.css
  src/app.ts          # 主页面交互
  src/debug.ts        # 调试页面交互
  dist/               # 构建后的浏览器脚本

backend/
  server.mjs          # 静态服务 + API 代理

local-data/           # 本地生成记录数据库，已 gitignore
local-photos/         # 你可以放本地测试照片，已 gitignore

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

产品模式：

```txt
http://localhost:5173/product.html
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
SILICONFLOW_IMAGE_EDIT_MODEL=Qwen/Qwen-Image-Edit-2509
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
SILICONFLOW_IMAGE_EDIT_MODEL=Qwen/Qwen-Image-Edit-2509
```

线上接口：

```txt
/api/analyze-image
/api/classify-layout
/api/roast
/api/generate-doodle
/api/debug/prompts
/api/debug/skills
```

注意：`/api/product-records` 是本地开发服务器里的文件型数据库接口，用于写入 `local-data/snap-roast-records.json`。Vercel Serverless 环境不适合作为持久文件数据库。

## 后端接口

```txt
POST /api/analyze-image
POST /api/classify-layout
POST /api/roast
POST /api/generate-doodle
GET  /api/product-records
POST /api/product-records
DELETE /api/product-records/:id
GET  /api/debug/prompts
GET  /api/debug/skills
```

## 本地数据

```txt
local-data/snap-roast-records.json
```

产品页每次生成完成后会把记录保存到这个 JSON 文件。记录包括原图 data URL、生成时间、模式、小票 SVG/文本、可选漫画结果。

```txt
local-photos/
```

这个文件夹给你放自己的测试照片。`local-data/` 和 `local-photos/` 都已经写入 `.gitignore`，不会提交到仓库。

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
