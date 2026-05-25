# Snap Roast Buddy

Snap Roast Buddy 是一个移动端相机式 AI 小票应用：拍照或导入照片后，后端分析图片、生成吐槽文案，前端把结果排成热敏纸小票，也可以生成黑白漫画贴纸。

当前默认入口是产品模式。打开 `/` 会直接进入 `frontend/index.html`。

## 当前版本

### 产品模式

- 真实手机摄像头取景，支持前后摄像头切换。
- 前置摄像头预览和保存方向已修正。
- 取景框保持竖屏 `3:4`；设置为横屏时，只在拍照输出前旋转为横向图片。
- 取景框内支持点击对焦反馈。
- 取景框内支持滑动倍率，当前为 `1x` 到 `3x`。
- 支持从设置页导入相册照片。
- 支持自动生成、小票、爆字、表情、漫画等模式。
- 生成后进入相册页，照片和小票同步横向滑动。
- 支持自定义删除确认弹窗。
- 相册优先保存到 Supabase；浏览器 IndexedDB/localStorage 作为临时兜底缓存。

### 测试与调试

- `frontend/index.html` 是移动端产品模式。
- `frontend/test.html` 是工程测试页，用于手动输入/上传图片并测试 AI 小票生成。
- 测试页每次步骤完成或失败会显示本次调用耗时。
- `frontend/debug.html` 是 Prompt、layout skills、SVG 预览调试面板。

## 生成流程

```txt
1. 获取照片
   - 产品模式：手机摄像头拍摄或从设置页导入
   - 测试页：上传图片或编辑图片描述

2. 图片分析
   - POST /api/analyze-image
   - 默认视觉模型：Pro/moonshotai/Kimi-K2.6

3. 排版选择
   - POST /api/classify-layout
   - 自动选择 receipt / big_text / pixel_expression

4. 文案生成
   - POST /api/roast
   - 默认文本模型：Pro/zai-org/GLM-4.7

5. 可选漫画
   - POST /api/generate-doodle
   - 默认图像编辑模型：Qwen/Qwen-Image-Edit-2509

6. 保存记录
   - Vercel：POST /api/product-records -> Supabase
   - 本地开发：backend/server.mjs 写入 local-data/snap-roast-records.json
   - 浏览器：IndexedDB/localStorage 兜底缓存
```

## 项目结构

```txt
frontend/
  index.html              # 移动端产品模式，默认入口
  test.html               # 工程测试页
  debug.html              # 调试面板
  styles.css
  src/app.ts              # 测试页交互
  src/product.ts          # 产品模式交互
  src/debug.ts            # 调试页交互
  dist/                   # 构建产物

api/
  _shared.mjs             # Vercel API 共享逻辑
  analyze-image.mjs
  classify-layout.mjs
  roast.mjs
  generate-doodle.mjs
  product-records.mjs
  product-records/[id].mjs

backend/
  server.mjs              # 本地开发静态服务 + API 代理

packages/layout/
  src/                    # 小票布局、渲染和技能规则执行

config/layout-skills/
  *.md / *.json           # 可调整的排版规则

docs/
  supabase-product-records.sql

local-data/               # 本地生成记录，已 gitignore
local-photos/             # 本地测试照片，已 gitignore
```

## 本地启动

```bash
npm install
npm run build:frontend
npm run dev
```

打开：

```txt
http://localhost:5173
```

常用页面：

```txt
http://localhost:5173/index.html
http://localhost:5173/test.html
http://localhost:5173/debug.html
```

本地测试 Supabase：

1. 在 `.env` 填好 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `SUPABASE_PRODUCT_RECORDS_TABLE`。
2. 先在 Supabase SQL Editor 执行下面的建表 SQL。
3. 运行 `npm run dev`。
4. 打开 `http://localhost:5173/test.html`。
5. 点击页面顶部的“测试 Supabase 连接”。

也可以直接访问：

```txt
http://localhost:5173/api/supabase-health
```

成功时会返回类似：

```json
{
  "ok": true,
  "table": "product_records",
  "sampleCount": 0
}
```

## 环境变量

复制 `.env.example` 为 `.env`，填入服务端密钥：

```env
SILICONFLOW_API_KEY=YOUR_API_KEY
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Pro/zai-org/GLM-4.7
SILICONFLOW_VISION_MODEL=Pro/moonshotai/Kimi-K2.6
SILICONFLOW_IMAGE_EDIT_MODEL=Qwen/Qwen-Image-Edit-2509

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_KEY
SUPABASE_PRODUCT_RECORDS_TABLE=product_records
```

`SUPABASE_SERVICE_ROLE_KEY` 是高权限 Secret key，只能放在服务端环境变量里。不要写进前端代码，不要提交到 Git。

## Supabase 数据库

在 Supabase SQL Editor 里执行：

```sql
create table if not exists public.product_records (
  id text primary key,
  original_image_url text not null,
  created_at timestamptz not null,
  description text,
  layout_type text not null,
  generation_mode text not null,
  roast_level text not null,
  sketch_mode text not null,
  ticket_html text,
  ticket_text text,
  sketch_image_url text,
  caption text,
  record jsonb not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_records_created_at_idx
  on public.product_records (created_at desc);

create or replace function public.set_product_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_records_set_updated_at on public.product_records;

create trigger product_records_set_updated_at
before update on public.product_records
for each row
execute function public.set_product_records_updated_at();

alter table public.product_records enable row level security;

drop policy if exists "product_records_no_public_access" on public.product_records;

create policy "product_records_no_public_access"
on public.product_records
for all
to anon, authenticated
using (false)
with check (false);
```

同一份 SQL 也保存在 `docs/supabase-product-records.sql`。

### 数据格式

`product_records` 会把常用字段拆成列，方便排序和后续查询；完整记录同时存在 `record jsonb`，避免前端字段变化时频繁迁移。

核心字段：

```ts
type PhotoRecord = {
  id: string;
  originalImageUrl: string;
  createdAt: string;
  description?: string;
  layoutType: "receipt" | "big_text" | "expression" | "sketch";
  generationMode: "auto" | "receipt" | "big_text" | "expression";
  roastLevel: "gentle" | "normal" | "spicy" | "public_execution";
  sketchMode: "none" | "top" | "bottom" | "standalone";
  ticketHtml?: string;
  ticketText?: string;
  sketchImageUrl?: string;
  caption?: string;
};
```

## Vercel 部署

项目已经包含 `vercel.json`：

```txt
Build Command: npm run build:frontend
Output Directory: frontend
Install Command: npm install
```

Vercel Environment Variables 需要配置：

```env
SILICONFLOW_API_KEY=YOUR_API_KEY
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Pro/zai-org/GLM-4.7
SILICONFLOW_VISION_MODEL=Pro/moonshotai/Kimi-K2.6
SILICONFLOW_IMAGE_EDIT_MODEL=Qwen/Qwen-Image-Edit-2509
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_KEY
SUPABASE_PRODUCT_RECORDS_TABLE=product_records
```

Vercel 根路径 `/` 直接使用 `frontend/index.html`。

## API

```txt
POST   /api/analyze-image
POST   /api/classify-layout
POST   /api/roast
POST   /api/generate-doodle
GET    /api/product-records
POST   /api/product-records
DELETE /api/product-records/:id
GET    /api/debug/prompts
GET    /api/debug/skills
GET    /api/supabase-health
```

## 常用命令

```bash
npm run check
npm run build:frontend
npm run dev
npm run demo
```

## Git 忽略策略

已忽略：

```txt
.env
.env.local
.env.development
.env.production
.env.preview
.env.*.local
.vercel/
node_modules/
frontend/dist/
local-data/
local-photos/
```

不要提交真实 API key、Supabase service role key、本地照片或本地生成记录。

## 后续硬件接入方向

- `POST /api/print`：接收 layout JSON 或 bitmap。
- ESC/POS 转换：把 `LayoutDocument` 转成热敏打印机位图数据。
- ESP32 通信：通过 HTTP、WebSocket、BLE 或串口转发打印任务。
- 打印队列：缓存失败任务，支持重试和状态回传。
