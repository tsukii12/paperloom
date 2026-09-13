<div align="center">

# PaperLoom · 织译

**一款论文 AI 翻译工具**

把论文 PDF 解析成结构化网页，用 LLM 翻译，左右双栏对照阅读。

🔒 本地运行 · 文档与 API Key 只存在你自己机器上

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/) [![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/) [![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/) [![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/) [![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文](README.md) · [English](README.en.md)

<img src="docs/screenshot-reader.png" alt="PaperLoom 阅读界面:双栏对照 + 批注高亮" width="880" />

</div>

---

## ✨ 功能

### 📄 解析与翻译

- **双引擎** —— Docling(轻量快速)/ MinerU(学术质量最佳)，设置页随时切换
- **按需安装** —— 引擎含 PyTorch、合计数 GB，**不随安装包分发**；点一下下载，装到用户目录即可用
- **结构化解析** —— 图片、表格按原文阅读位置内联，上下关系不乱；公式转 LaTeX 渲染
- **任意 OpenAI 兼容接口** —— OpenAI / DeepSeek / GLM / 通义 / Kimi / 硅基流动 / 阶跃星辰…
- **批量并发翻译** —— 并发数与推理等级可调；公式占位保护；失败块自动重试并标记；每批即时落盘，过程实时可见

### 📖 阅读

- **双栏对照** —— 按块逐行对齐，中缝一条细线像摊开的书页；可切 原文 / 译文 / 双栏
- **论文正文字体** —— 中文与西文分别选择，只作用于正文，界面不受影响
- **批注划线** —— 选中原文 → 高亮(4 色)/ 下划线 / 批注笔记；右侧批注栏汇总，点击定位
- **划词翻译** —— 选中原文点「翻译」，即时弹窗显示译文
- **图片灯箱** —— 点击放大，`←` `→` 切换上一张 / 下一张，可直接保存
- **导出** —— 独立 HTML(单文件分发)/ **直接另存为 PDF**(无头 Edge/Chrome 打印，矢量文字可选中，不弹打印对话框)

### 🗂️ 管理

- **文库** —— 文件管理器式导航：双击进入文件夹、面包屑、返回上一级、新建 / 重命名 / 移动；多级嵌套；多选批量操作；拖拽归类
- **搜索** —— 跨全部文件夹搜索，结果带可点击的路径
- **外观** —— 浅色 / 深色 / 跟随系统；5 套主题色 + 任意自定义色；界面缩放 90%–125%
- **下载源** —— 引擎包走 PyPI 镜像(默认清华)，解析模型走 hf-mirror / ModelScope / HuggingFace
- **处理日志** —— 点状态标签查看转换 / 翻译的完整过程

## 🚀 快速开始

> 依赖：[uv](https://docs.astral.sh/uv/)(管理 Python 3.12)、Node.js 20+

```bash
# 1️⃣ Python 环境
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe -r requirements.txt

# 2️⃣ 前端构建
cd web && npm install && npm run build && cd ..

# 3️⃣ 启动(自动打开浏览器)
.venv/Scripts/python.exe run.py
```

打开 <http://127.0.0.1:8686> 即可。

> 💡 开发时前端可跑 `cd web && npm run dev`(已配好 `/api` 代理到 8686)，改代码即时热更。

## 🧭 使用流程

| 步骤 | 操作 |
| --- | --- |
| 1️⃣ 配置引擎 | 设置 → 转换引擎 → 点「下载安装」(首次约需下载 1 GB) |
| 2️⃣ 上传 | 文库页拖入 PDF(可多选)，也可直接拖进某个文件夹 |
| 3️⃣ 转换 | 点「转换」。首次还会下载解析模型 |
| 4️⃣ 配置 API | 设置 → 翻译接口，填 Base URL / API Key / 模型名，点「测试连接」 |
| 5️⃣ 翻译 | 点「翻译」，点状态标签可看实时日志 |
| 6️⃣ 阅读 | 点「阅读」进入双栏对照 |

## 🖥️ 桌面应用

`desktop/electron/` 内：

```bash
npm install          # 已装可跳过
npm run start        # 开发模式：拉起后端并打开桌面窗口
npm run dist         # 打包 NSIS 安装包 → ../dist-electron/
```

**安装包不含转换引擎。** 全打进去会到 400 MB+，现在只带 Electron + Python 运行时 +
基础依赖(FastAPI / uvicorn / httpx 等，约 15 MB)，安装包约 **144 MB**。首次使用到
「设置 → 转换引擎」下载，引擎装到 `resources/paperloom/data/engines/<engine>`，
再挂到 `sys.path` / `PYTHONPATH` —— 后端进程与转换 worker 子进程都能导入，装完立即可用。

打包前需要 `.venv-base`(只含基础依赖的最小环境)：

```bash
uv venv .venv-base --python 3.12
uv pip install --python .venv-base/Scripts/python.exe fastapi "uvicorn[standard]" python-multipart httpx truststore
```

安装包按用户安装(`perMachine=false`)，数据存放在 `resources/paperloom/data`。
`desktop/vc-runtime/` 里是随包的 VC++ 运行库，装完引擎后会自动补进 `torch/lib`，
用于绕过旧系统上的 `WinError 1114`。

## 📁 目录结构

```
paperloom/
├─ server/                  # FastAPI 后端
│  ├─ app.py                # 路由 + 静态托管 + 引擎按需安装
│  ├─ db.py                 # SQLite(文档元数据、批注、文件夹树)
│  ├─ jobs.py               # 双通道后台任务队列(转换 / 翻译，可取消)
│  ├─ converter/            # 引擎适配，输出统一的 Block 模型
│  │  ├─ base.py            # Block 定义 + 引擎分发
│  │  ├─ docling_backend.py / docling_worker.py
│  │  └─ mineru_backend.py
│  ├─ render.py             # blocks → 独立 HTML
│  ├─ translator.py         # OpenAI 兼容批量翻译
│  └─ settings.py           # data/settings.json 持久化
├─ web/                     # React + TS + Tailwind 前端
│  ├─ src/pages/            # Documents(文库) / Reader(阅读) / Settings
│  ├─ src/components/       # Dropdown / MoveDialog / ThemeSwitch / BrandMark …
│  └─ src/theme.ts          # 主题、主题色、论文字体、界面缩放
├─ desktop/
│  ├─ electron/             # main.js + electron-builder 配置
│  └─ vc-runtime/           # 随包的 VC++ 运行库(修旧系统的 torch 加载失败)
├─ docs/UI-REDESIGN.md      # 界面设计规范
├─ scripts/mock_llm.py      # 开发用 Mock LLM(只验证翻译管线，不真正翻译)
└─ run.py                   # 一键启动
```

## 🏗️ 架构要点

- **引擎与主程序解耦** —— `converter/__init__.py` 为空，docling / mineru 的 import 全在
  函数内部和 worker 子进程里。所以**不装引擎也能正常启动**，只是转换时会提示去安装 ——
  这也是安装包能压到 144 MB 的前提。
- **引擎安装位置** —— `data/engines/<engine>`，用随包的 `uv` 执行
  `uv pip install --target`。每个引擎独立目录，各自解析依赖、互不干扰。
- **路径注入** —— 启动时把引擎目录挂到 `sys.path` 和 `PYTHONPATH`；转换 worker 是
  `sys.executable` 子进程，从 `os.environ` 继承 —— 一处设置即可，装完无需重启。
- **只监听 127.0.0.1** —— CORS 只放行本机来源。

## ⚠️ 说明与已知事项

- 🔑 **API Key 存放** —— 明文存在 `data/settings.json`(仅本机、仅监听回环地址)。
  `.gitignore` 已排除 `data/`，**不要把它提交到公开仓库**。
- 🗑️ **删除即备份** —— 文档删除是移入 `data/trash/`，不直接删除。
- 🧩 **VC++ 运行库** —— `torch` 的 `c10.dll` 需要较新的 VC++ 运行库，旧系统会报
  `WinError 1114`。桌面版已随包携带并自动补进 `torch/lib`；源码运行若遇到，
  装一下 [VC++ 2015-2022 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe) 即可。
- ⏳ **首次转换较慢** —— 要下载解析模型(Docling 约数百 MB)。
- 🖨️ **导出 PDF 耗时** —— 图文较多的论文约 25–60 秒(瓶颈是无头浏览器排版本身)。

## 🙏 致谢

- [Docling](https://github.com/docling-project/docling) / [MinerU](https://github.com/opendatalab/MinerU) —— PDF 解析
- [FastAPI](https://fastapi.tiangolo.com/) · [React](https://react.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Electron](https://www.electronjs.org/) · [KaTeX](https://katex.org/)

## 📜 开源许可

[MIT](LICENSE) © 2026 Tsuki
