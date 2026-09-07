# VFX Player PRD (v0.1)

## 产品定位

**PureRef for Video**

面向： - UE VFX - Unity VFX - TA - Houdini Artist - Animator - Shader
Artist

目标：

> 一款专门用于逐帧分析视频、管理分析记录、快速 Scrub 的专业播放器。

------------------------------------------------------------------------

# MVP 核心功能

## 1. Viewer

-   视频播放
-   暂停
-   倒放
-   逐帧前进/后退
-   跳转指定帧
-   跳转指定时间
-   播放速度
-   GPU 硬解
-   当前 Frame / Time / FPS / Resolution 显示

------------------------------------------------------------------------

## 2. Viewer Scrub（第一优先级）

直接在画面拖动：

-   左右拖动逐帧
-   Shift：慢速
-   Alt：1 Pixel = 1 Frame
-   无惯性
-   超低延迟
-   拖动自动暂停
-   松开停留当前帧

------------------------------------------------------------------------

## 3. Timeline

-   播放头
-   Marker
-   滚轮缩放
-   Ctrl+滚轮缩放
-   Marker 拖动
-   点击定位
-   后续支持缩略图

------------------------------------------------------------------------

# Bookmarks（第二优先级）

## 每个 Bookmark 包含

-   UUID
-   Frame
-   Timestamp
-   Title
-   Description
-   Color
-   Tags\[\]
-   Favorite
-   Rating
-   Thumbnail
-   Annotation\[\]
-   CreatedTime
-   UpdatedTime

------------------------------------------------------------------------

## 创建

快捷键：

M

流程：

1.  当前帧创建
2.  自动截图缩略图
3.  默认标题
4.  自动选中
5.  可立即修改标题

------------------------------------------------------------------------

## 点击书签

必须完成：

-   暂停视频
-   跳转对应 Frame
-   Timeline Marker 高亮
-   Bookmarks 高亮
-   加载 Annotation
-   Viewer 显示 Annotation
-   自动滚动到当前 Bookmarks

实现：

Viewer ⇄ Timeline ⇄ Bookmark ⇄ Annotation

四者必须双向同步。

------------------------------------------------------------------------

## Bookmarks 列表

每项：

-   缩略图
-   标题
-   Frame
-   Time
-   Tag
-   Favorite
-   Rating

支持：

-   List View
-   Thumbnail View

------------------------------------------------------------------------

## 搜索

搜索：

-   标题
-   标签
-   描述
-   Frame

------------------------------------------------------------------------

## 排序

-   Frame
-   Title
-   Time
-   Rating
-   CreateTime
-   UpdateTime

------------------------------------------------------------------------

## 筛选

-   Color
-   Tag
-   Favorite
-   Has Annotation

------------------------------------------------------------------------

## 多选

支持：

-   Ctrl
-   Shift
-   Ctrl+A

批量：

-   删除
-   标签
-   改颜色
-   收藏
-   导出

------------------------------------------------------------------------

## 右键菜单

-   Jump
-   Rename
-   Edit
-   Color
-   Tag
-   Favorite
-   Copy
-   Export Screenshot
-   Delete

------------------------------------------------------------------------

# Annotation

绑定 Frame。

不是绑定时间。

类型：

-   Arrow
-   Circle
-   Rectangle
-   Brush
-   Text
-   Highlight

支持：

-   多选
-   删除
-   锁定
-   隐藏
-   图层顺序

坐标：

Viewer Normalized Coordinate（0\~1）

------------------------------------------------------------------------

# Analysis Panel

三个 Tab：

Bookmarks

Annotations

Properties

------------------------------------------------------------------------

# Notes

每个 Bookmark 支持 Markdown：

例如：

-   Shader 思路
-   UE 实现
-   Houdini 思路
-   疑问
-   TODO

------------------------------------------------------------------------

# Workspace

保存：

-   Bookmarks
-   Annotation
-   Notes
-   Timeline Zoom
-   Window Layout

下次继续分析。

------------------------------------------------------------------------

# Screenshot

Ctrl+C

复制当前帧

Ctrl+Shift+C

复制带标注

------------------------------------------------------------------------

# Compare（v0.2）

左右视频：

-   同步播放
-   同步 Scrub
-   Overlay
-   Split

------------------------------------------------------------------------

# Onion Skin（v0.2）

显示：

上一帧

下一帧

透明度可调

------------------------------------------------------------------------

# 快捷键

Space：播放暂停

← →：逐帧

↑ ↓：±5 Frame

J K L：倒放 停止 播放

M：创建 Bookmark

Delete：删除

Ctrl+F：搜索

Ctrl+S：保存项目

Ctrl+O：打开视频

Ctrl+MouseWheel：Timeline Zoom

------------------------------------------------------------------------

# 技术建议

语言：

C++20

UI：

Qt6

视频：

FFmpeg

硬解：

D3D11VA / DXVA2

渲染：

D3D11

项目：

JSON

平台：

Windows

------------------------------------------------------------------------

# 后续版本

v0.2

-   Compare
-   Onion Skin
-   Timeline Thumbnail

v0.3

-   PNG Sequence
-   EXR Sequence
-   GIF Export

v1.0

-   AI Analysis
-   OCR
-   Whisper
-   自动识别 Bloom / Distortion / Camera Shake
