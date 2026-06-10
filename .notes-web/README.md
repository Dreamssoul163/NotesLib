# 本地文件夹 PDF 浏览器

这是一个本地运行的轻量级网站，用于浏览指定文件夹并在右侧预览 PDF 文件（只读）。

## 要点
- 左侧显示文件夹树（可展开/折叠）。
- 点击 PDF 文件时，右侧以内嵌方式预览（上下滚动）。
- 网站不会修改任何磁盘上的文件，只做读取与显示。

## 快速开始

```bash
cd /d C:\\Users\\zhou-\\OneDrive\\NotesLib\\.notes-web
```

1. 安装依赖：

```bash
npm install
```

2. 启动服务器（指定要浏览的本地文件夹）：

```bash
# Windows 示例：
node server.js --root "C:\Users\zhou-\OneDrive\NotesLib\数学" --port 3000

# 或使用环境变量：
set ROOT_DIR=C:\\Users\\zhou-\\OneDrive\\NotesLib\\数学
node server.js
```

3. 打开浏览器访问 `http://localhost:3000`。

## 文件结构
- `server.js`：Node/Express 后端，提供目录列表与文件流接口。
- `public/`：前端静态资源（`index.html`、`main.js`、`styles.css`）。

## 安全与限制
- 服务器会将所有请求限制在 `--root` 指定的根目录下，防止越界访问其他系统文件。
- 仅做只读操作。

## 如果需要改进
- 增加搜索功能。
- 支持全文索引与高亮（例如基于 PDF 文本抽取）。
- 支持其他文件类型的预览。
