/* ==================================================================
   学习计划板 · study-website — main.js
   Region 1: 首屏（数字滚动、本地 Canvas 点阵背景、移动端菜单）
   Region 2: 可自定义学习计划板（周期 / 日历 / 时间轴 / 复盘 / 笔记 / 模块）
   Region 3: 计划编辑（模块、任务、时段、周期、JSON 导入导出）
   Region 4: 可自定义周期（月分块年历 / 周期设置面板 / 每日时段编辑）
   Region 5: 资源仓库（CAD 图纸画廊 / 我的资料仓库 / 大图预览）
   Region 6: 数据中心（热力图 / 各线完成度 / 打卡趋势）
   Region 7: 复盘墙（汇总 / 搜索 / 筛选 / 导出 Markdown）
   无框架、无构建、无外部请求。状态只存在 localStorage 里。
   ================================================================== */
(function () {
  'use strict';

  /* ----------------------------------------------------------------
     Data — 计划周期由 state.plan.period 决定，日历 / 进度 / 时间轴都从它推导。
     这里没有任何写死的日期：默认周期就是「今年 1 月 1 日 → 12 月 31 日」，
     换一年会自动跟着变，闰年 366 天也自动适配。
     ---------------------------------------------------------------- */
  function thisYearPeriod() {
    var y = new Date().getFullYear();
    return {
      start: y + '-01-01',
      end: y + '-12-31',
      restWeekdays: [],       /* 默认不预设任何休息日，休息日完全由用户自己在周期面板里编排 */
      extraRest: [],          /* 额外休息日：法定节假日、寒暑假等，自己加 */
      extraWork: []           /* 调休学习日：本来是周末但那天要学 */
    };
  }

  var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* 时段类型：core 会算进「当天是否打卡完成」，其余只是展示用 */
  var SLOT_KINDS = ['core', 'light', 'rest', 'ritual'];
  var SLOT_KIND_CN = { core: '主线', light: '轻量', rest: '自由', ritual: '作息' };

  /* 默认作息模版 —— 一套「学习日」、一套「休息日」，进编辑模式后可以整套改。
     时段名先写成「主线一 / 二 / 三」这种占位，你把要学的东西填进去就行。
     类型 kind：core = 算进「当天打卡完成」，其余只是展示。 */
  var DEFAULT_SLOTS = {
    study: [
      { id: 'wake', time: '08:00', title: '起床 · 早餐', desc: '把今天最重要的三件事写下来，纸上也行、这里写也行。', kind: 'ritual' },
      { id: 'main1', time: '09:00 – 11:00', title: '主线一 · 最需要专注的那门', desc: '一天里状态最好的两小时留给最难的东西。先动手，再回看讲解。', kind: 'core' },
      { id: 'main2', time: '14:00 – 16:00', title: '主线二', desc: '看一个知识点就马上敲几个小例子。只看不练等于没学。', kind: 'core' },
      { id: 'main3', time: '16:30 – 17:30', title: '主线三', desc: '一天真正搞懂一个能用的点，看完用自己的话记进下面的笔记。', kind: 'core' },
      { id: 'move', time: '17:30 – 18:00', title: '运动 · 散步 · 亲近自然', desc: '出门走走。别把日子过成室内模式。', kind: 'light' },
      { id: 'main4', time: '19:00 – 21:00', title: '晚间主线', desc: '两小时整块时间，用来精读、练手或者补进度。', kind: 'core' },
      { id: 'free', time: '21:00 之后', title: '家人 · 聊天 · 喜欢的事', desc: '这一段不排任务。', kind: 'rest' },
      { id: 'wind', time: '23:30 – 24:00', title: '收心 · 睡觉', desc: '23:30 开始收心，24:00 前睡。睡够才学得动。', kind: 'ritual' }
    ],
    rest: [
      { id: 'wake', time: '08:00', title: '自然醒 · 早餐', desc: '休息日不设闹钟。', kind: 'ritual' },
      { id: 'family', time: '上午', title: '陪家人 · 出门走走', desc: '陪家里人，或者去户外待一会儿。', kind: 'rest' },
      { id: 'move', time: '17:30 – 18:00', title: '运动 · 散步', desc: '照旧，动一动。', kind: 'light' },
      { id: 'keep', time: '19:30 – 20:00', title: '保持线（不排满）', desc: '休息日只求不断线：背几个词、看一小节都算。', kind: 'light' },
      { id: 'wind', time: '23:30 – 24:00', title: '收心 · 睡觉', desc: '', kind: 'ritual' }
    ]
  };

  /* ----------------------------------------------------------------
     Four tracks — 每条线：阶段大纲 + 配套资源 + 本线笔记
     CAD 每阶另挂 4 张「同题四练」图纸：摹 / 临 / 默 / 检
     任务是「阶段」，不绑具体日期 —— 你按自己的周期节奏往下走
     ---------------------------------------------------------------- */
  var SHEET_MODES = [
    { k: 'MO', cn: '摹', tip: '带尺寸，照着画' },
    { k: 'LIN', cn: '临', tip: '无尺寸，照着临' },
    { k: 'MH', cn: '默', tip: '只给尺寸，自己画' },
    { k: 'JIAN', cn: '检', tip: '标了易错点，对照检查' }
  ];

  /* ------------------------------------------------------------------
     DEFAULT_TRACKS —— 出厂起步模板（四条学习线）。用户可以整套替换、增删改，
     改完存在 localStorage 的 state.plan 里；这个常量只在「恢复默认」时读。
     每个任务（阶）有一个稳定的 sid，进度按 sid 记，删中间一阶不会串位。
     ------------------------------------------------------------------ */
  var DEFAULT_TRACKS = [
    {
      id: 'cad',
      idx: '01',
      name: 'CAD 制图',
      meta: '10 阶 · 40 张图纸',
      title: '制图渐进大纲',
      sub: '从图层规范一路画到完整零件图出图。每个图形配四张 —— 摹（带尺寸照着画）、临（无尺寸照着临）、默（只给尺寸自己画）、检（标了易错点对照检查）。全程按国标走，画出来的图拿得出手。',
      ph: 'CAD：今天搞懂了「对象捕捉」和「正交」的区别 —— 一个抓点，一个锁方向。',
      steps: [
        { n: 1, phase: '基础', dxf: 'D01', title: '界面 · 坐标系 · 图层规范', desc: '摸清命令行与动态输入；按 GB/T 4457.4 建图层（粗实线 / 细实线 / 细点画线 / 细虚线 / 尺寸标注），线宽 0.70 与 0.25。练直线、正交 F8、对象捕捉 F3。' },
        { n: 2, phase: '基础', dxf: 'D02', title: '基础绘图与编辑命令', desc: '圆 / 圆弧 / 矩形 / 偏移 / 修剪 / 延伸 / 圆角 / 镜像。目标：给一张简单平面图形，不翻教程能自己画完。' },
        { n: 3, phase: '基础', dxf: 'D03', title: '精确绘图与阵列', desc: '极轴追踪、对象捕捉追踪、夹点编辑；圆周分布的孔用极轴阵列，别一个个画。临摹一张对称件平面图，练到「一次点准」。' },
        { n: 4, phase: '标注', dxf: 'D04', title: '尺寸标注样式（GB/T 4458）', desc: '建国标标注样式：箭头、字高 3.5、精度与公差。练线性 / 对齐 / 直径 / 半径 / 角度标注；小尺寸放内层、大尺寸放外层。' },
        { n: 5, phase: '标注', dxf: 'D05', title: '文字 · 表面粗糙度 · 技术要求', desc: '长仿宋（simfang.ttf）字高 3.5 / 5 / 7。尺寸文字里用 %%c、%%d、%%p，不要写 Unicode 符号。练一遍技术要求和技术要求符号。' },
        { n: 6, phase: '投影', dxf: 'D06', title: '三视图 · 主视图', desc: '第一角投影法：主视图在左上。先把可见轮廓的粗实线画准，不可见轮廓用细虚线，线型别混。' },
        { n: 7, phase: '投影', dxf: 'D07', title: '三视图 · 俯视图 + 左视图', desc: '俯视图在主视图正下方（长对正），左视图在正右方（高平齐），宽度相等。公共尺寸只标一次，不重复。' },
        { n: 8, phase: '投影', dxf: 'D08', title: '剖视图 · 断面图 · 剖面线', desc: '剖面线 45°，同一零件方向一致、间距均匀，只打在剖到的实体上。练一个带孔的底板全剖。' },
        { n: 9, phase: '出图', dxf: 'D09', title: '图幅图框 + 标题栏', desc: '按 GB/T 14689 定图幅与留边（留装订边）；标题栏按 GB/T 10609.1，180 × 56 放右下角，视图必须避让。' },
        { n: 10, phase: '出图', dxf: 'D10', title: '综合成图 + 打印出图', desc: '独立完成一张完整零件图并出图：Ctrl+P → DWG To PDF.pc3 → A3 → 窗口框住图框 → 勾选居中打印、比例 1:1。' }
      ],
      resources: [
        { tag: '本站', name: '40 张国标练习图纸', by: '10 个图形 × 摹 / 临 / 默 / 检', why: '就挂在本页每一阶下面，点一下直接下载 DXF，用任意 CAD 软件打开就能画。' },
        { tag: '国标', name: 'GB/T 4457.4 图线 · GB/T 4458.4 尺寸注法', by: '国家标准全文公开系统（免费查）', why: '线型线宽、箭头字高的权威出处。图纸上每一条线都能在这里找到依据，做作业被问起来有底气。' },
        { tag: '国标', name: 'GB/T 14689 图幅格式 · GB/T 10609.1 标题栏', by: '国家标准全文公开系统', why: '画图框和标题栏照这个来 —— 第 9 阶那张 D09 练的就是它。' },
        { tag: '软件', name: 'AutoCAD 2022', by: 'Autodesk 官网 · 学生与教育版可申请免费', why: '命令行输入、正交 F8、对象捕捉 F3，这条线全靠它练手上功夫。用不起 AutoCAD 就换中望 CAD 或 LibreCAD，命令思路基本通用。' },
        { tag: '教材', name: '任意按国标编写的制图教材', by: '高等教育出版社 / 机械工业出版社 均有', why: '挑一本以 GB/T 为准、带大量练习的教材当底本，比只看零散网课扎实；有配套习题集更好。' }
      ]
    },
    {
      id: 'python',
      idx: '02',
      name: 'Python',
      meta: '10 阶 · 零基础到面向对象',
      title: 'Python 渐进大纲',
      sub: '从装环境到类与对象，一路写到能自己调接口。第 10 阶直接接上 AI 那条线的 API 调用 —— 两条线同一天收口。每一天都在敲，不是在看。',
      ph: 'Python：今天把 for + zip 串起来用了，比昨天写的一堆 if 干净得多。',
      steps: [
        { n: 1, phase: '基础', title: '环境 · 变量 · 输入输出', desc: '装好 Python 与编辑器，跑通第一个脚本。变量命名规则、print 与 input、f-string 拼接。今天的目标：不查资料写出「输入姓名并打招呼」。' },
        { n: 2, phase: '基础', title: '数据类型 · 运算符 · 字符串', desc: 'int / float / str / bool 与类型转换；算术、比较、逻辑三类运算符；字符串常用方法 split / strip / replace。' },
        { n: 3, phase: '基础', title: '列表 · 元组', desc: '索引与切片、append / insert / remove / pop、排序与反转；元组为什么不可变、什么时候该用它。' },
        { n: 4, phase: '基础', title: '字典 · 集合', desc: '键值对、get / keys / values / items 遍历；集合去重与交并差。练：统计一段文字里每个字出现的次数。' },
        { n: 5, phase: '流程', title: '条件判断', desc: 'if / elif / else、and / or / not、in 判断、三元表达式。重点记住：Python 靠缩进划分代码块，不是花括号。' },
        { n: 6, phase: '流程', title: '循环', desc: 'for 与 while、range / enumerate / zip、break / continue、嵌套循环。练：打印九九乘法表，一行搞定。' },
        { n: 7, phase: '组织', title: '函数', desc: 'def 定义、位置参数 / 默认参数 / 关键字参数、*args 与 **kwargs、返回值、局部与全局作用域、lambda。' },
        { n: 8, phase: '组织', title: '文件读写 · 异常处理', desc: 'open 与 with 语句、读写文本与 CSV；try / except / else / finally、raise 主动抛错。练：把一段文字写进文件再读回来统计行数。' },
        { n: 9, phase: '进阶', title: '类与对象', desc: 'class 定义、__init__ 构造、self、实例属性与方法、继承与重写、__str__ 魔法方法。用「学生」类练一遍。' },
        { n: 10, phase: '进阶', title: '模块 · 常用库 · 收口项目', desc: 'import 与 from、pip 装包、虚拟环境；json 读写、requests 发请求。收口：做一个命令行单词卡工具 —— 明天 AI 那步就用它调 API。' }
      ],
      resources: [
        { tag: '教材', name: '《Python编程：从入门到实践》（第3版）', by: 'Eric Matthes 著', why: '零基础首选。前半本讲语法、后半本带项目，配套代码齐全，跟着敲就行。' },
        { tag: '在线', name: '廖雪峰 Python 教程', by: 'liaoxuefeng.com · 免费中文', why: '中文、免费、一直讲到面向对象和常用库。第 9–10 阶讲类比教材更清楚。', url: 'https://liaoxuefeng.com/' },
        { tag: '文档', name: 'Python 官方中文文档', by: 'docs.python.org/zh-cn', why: '查函数签名和标准库用它。学 Python 迟早要会自己查官方文档，别只会搜博客。', url: 'https://docs.python.org/zh-cn/3/' },
        { tag: '视频', name: '黑马程序员 Python 入门', by: 'B站 · 黑马程序员官方', why: '中文视频，节奏稳，配套讲义能直接当笔记。哪一阶卡住就看对应那一节，比翻书快。' },
        { tag: '视频', name: '小甲鱼《零基础入门学习Python》', by: 'B站 · 鱼C工作室', why: '讲得口语化、段子多，零基础不容易被劝退 —— 适合某一阶死活看不懂时换个人讲。' },
        { tag: '练习', name: 'LeetCode 简单题 / 洛谷入门题', by: '在线判题，免费', why: '第 3 阶之后每天挑一道。练手用，目标是「能写出来」，不是刷题量。' }
      ]
    },
    {
      id: 'ai',
      idx: '03',
      name: 'AI',
      meta: '10 阶 · 零基础起步',
      title: 'AI 基础大纲',
      sub: '从「AI 到底是什么」开始，只讲能懂、能用的，不推公式、不碰模型训练。第 8–10 阶会真的动一次手。',
      ph: 'AI：原来「幻觉」不是它坏了，是它本来就在猜下一个词 —— 所以得给它资料再问。',
      steps: [
        { n: 1, phase: '认知', title: 'AI 到底是什么', desc: '把 AI / 机器学习 / 深度学习 / 大模型四层关系理清，分清「训练」和「推理」。今天不写代码 —— 能用自己的话讲给家里人听懂，就算过关。' },
        { n: 2, phase: '上手', title: '把 AI 当工具用：提示词四要素', desc: '角色、任务、输出格式、约束条件。同一个问题分别试两个模型，感受它们的差别在哪。' },
        { n: 3, phase: '上手', title: '提示词进阶', desc: '给例子（Few-shot）、让它分步推理（Chain-of-Thought）。今天就拿它整理你某一门课的笔记，看输出能不能直接用。' },
        { n: 4, phase: '原理', title: '数据的直觉：向量与矩阵', desc: '先别碰公式。用 Python 列表嵌套理解「维度」和「形状」，再 pip 装 numpy 看一眼 shape 和矩阵乘法。目标是建立画面感，不是会推导。' },
        { n: 5, phase: '原理', title: '机器学习第一课', desc: '特征、标签、损失、梯度下降 —— 全程用「猜数字 → 看差多少 → 调一点」的类比走一遍，不推导公式。' },
        { n: 6, phase: '原理', title: '神经网络', desc: '神经元、激活函数、反向传播。主看 3Blue1Brown 的动画，看完能说出「反向传播在干嘛」就够。' },
        { n: 7, phase: '原理', title: '大模型原理', desc: 'Token、上下文窗口、注意力机制。看李宏毅讲 Transformer 那一讲，重点听注意力机制为什么有用。' },
        { n: 8, phase: '边界', title: 'AI 为什么会胡说', desc: '幻觉是怎么来的、它为什么答得那么自信。了解 RAG（检索增强）的概念 —— 先把资料喂给它，再让它回答。' },
        { n: 9, phase: '边界', title: '评估与边界', desc: '哪些事该交给 AI、哪些绝对不能（涉密数据、要担责的判断、真要动手的活）。学会用第二个问题去验证它第一个答案。' },
        { n: 10, phase: '动手', title: '跑通第一个 AI 脚本', desc: '用 Python 的 requests 调一次大模型接口，把提示词写进代码里。收口：做一个自用小工具，比如把一段英文丢进去让它批改语法。' }
      ],
      resources: [
        { tag: '课程', name: '李宏毅《机器学习 2025》', by: '中国台湾大学 · B站（已授权转载）', why: '中文授课，2025 版直接讲大模型与 Transformer，配课件和作业。第 6–7 阶主力。B站搜「李宏毅 机器学习」。' },
        { tag: '课程', name: '吴恩达《AI For Everyone》', by: 'Coursera · 可免费旁听', why: '不讲代码，约 6 小时把 AI 的全局认知建立起来 —— 第 1 阶打底就靠它。国内访问可能需要网络工具。' },
        { tag: '课程', name: '《ChatGPT Prompt Engineering for Developers》', by: 'DeepLearning.AI · 免费', why: '约 2 小时，系统讲提示词怎么写，第 2–3 阶主力。英文原声、有中文字幕版。' },
        { tag: '视频', name: '3Blue1Brown《神经网络》系列', by: 'B站官方号 / YouTube', why: '用动画讲反向传播和注意力机制，全网讲得最直观，约 2 小时。第 6 阶看这个。' },
        { tag: '书', name: '李沐《动手学深度学习》', by: 'zh.d2l.ai · 开源免费', why: '中文、代码驱动，每章配 Jupyter Notebook。当延伸读物，不要求跟上，先混个眼熟。', url: 'https://zh.d2l.ai/' },
        { tag: '练习', name: 'Kaggle Learn《Intro to Machine Learning》', by: 'kaggle.com/learn · 免费', why: '免费微课，真实数据集边学边练。第 9–10 阶拿它练手，顺便看看真实数据长什么样。', url: 'https://www.kaggle.com/learn' }
      ]
    },
    {
      id: 'english',
      idx: '04',
      name: '英语',
      meta: '10 阶 · 每天 2 h',
      title: '英语精读大纲',
      sub: '和 CAD、Python 一样按满 2 小时排：精读 50 min + 背词 30 min + 跟读复述 25 min + 听写 15 min。一阶一课，把英语从「看得懂」推到「说得出、写得对」。',
      ph: '英语：Lesson 4 那段跟读比昨天顺了，就是 past tense 老忘。',
      goals: [
        { label: '累计背词', value: '200 个', hint: '每天 20 个，当天过、次日复盘' },
        { label: '累计精读', value: '10 课', hint: '新概念 2 的 Lesson 1–10' },
        { label: '累计复述', value: '100 句', hint: '每天 10 句，说出口才算' },
        { label: '累计听写', value: '10 段', hint: '每天一段，抓拼写和时态' }
      ],
      steps: [
        { n: 1, phase: '精读', title: 'Lesson 1 · 一般现在时', desc: '精读 50 min：逐句读 Lesson 1，把动词全圈出来，确认第三人称单数变化。背词 30 min：20 个新词，先看例句再记拼写。跟读复述 25 min：音频放一句跟一句，然后合书复述 10 句。听写 15 min：听写今天课文的前半段。' },
        { n: 2, phase: '精读', title: 'Lesson 2 · 现在进行时', desc: '精读 50 min：Lesson 2，分清「一般现在时」和「现在进行时」什么时候用哪个。背词 30 min：20 个新词 + 复盘昨天记不住的。复述 25 min：10 句，尽量用上今天新词。听写 15 min：听写昨天的课文，对照原文改错。' },
        { n: 3, phase: '精读', title: 'Lesson 3 · 一般过去时', desc: '精读 50 min：Lesson 3，把课文里所有动词改成过去式，注意规则变化和不规则变化两套。背词 30 min：20 个。复述 25 min：用过去时讲一遍昨天做了什么。听写 15 min：听写今天课文。' },
        { n: 4, phase: '精读', title: 'Lesson 4 · 现在完成时', desc: '精读 50 min：Lesson 4，搞清现在完成时和一般过去时的差别 —— 一个说「已经怎样」，一个说「什么时候怎样」。背词 30 min：20 个。复述 25 min：10 句。听写 15 min：听写前四课里最容易错的句子。' },
        { n: 5, phase: '复盘', title: 'Lesson 5 · 前五课总复盘', desc: '精读 50 min：Lesson 5 新课文，同时把 Lesson 1–5 通读一遍。背词 30 min：前五课 100 个词整体过一遍，只留下仍然记不住的。复述 25 min：从五课里各挑两句复述。听写 15 min：一段综合小测，检验前五天的底子。' },
        { n: 6, phase: '精读', title: 'Lesson 6 · 一般将来时', desc: '精读 50 min：Lesson 6，分清 will 和 be going to。背词 30 min：20 个。复述 25 min：用将来时讲一遍接下来的安排。听写 15 min：听写今天课文。' },
        { n: 7, phase: '精读', title: 'Lesson 7 · 过去进行时', desc: '精读 50 min：Lesson 7，过去进行时和 when / while 的搭配。背词 30 min：20 个。复述 25 min：10 句，注意叙述一件被打断的事。听写 15 min：听写昨天课文。' },
        { n: 8, phase: '精读', title: 'Lesson 8 · 情态动词', desc: '精读 50 min：Lesson 8，can / must / should / may 的语气差别在哪。背词 30 min：20 个。复述 25 min：用情态动词给自己写三条规矩，再说出来。听写 15 min：听写今天课文。' },
        { n: 9, phase: '精读', title: 'Lesson 9 · 比较级与最高级', desc: '精读 50 min：Lesson 9，形容词副词的比较级、最高级，注意不规则变化。背词 30 min：20 个。复述 25 min：用比较级对比两个东西。听写 15 min：听写今天课文。' },
        { n: 10, phase: '收口', title: 'Lesson 10 · 阶段总复盘', desc: '精读 50 min：Lesson 10，再把前 10 课通读一遍。背词 30 min：200 个词整体过一遍，筛出仍然记不住的，单独列一张清单带走。复述 25 min：挑三段最有把握的重录一次，和最开始的录音对比。听写 15 min：听写最后一段 —— 收口。' }
      ],
      resources: [
        { tag: '教材', name: '《新概念英语》第 2 册 + 配套音频', by: 'L.G. Alexander', why: '精读和跟读的底本。音频放一句跟一句，比默读有效得多。' },
        { tag: '方法', name: '「听写 + 复述」双循环', by: '本页内置节奏 · 每天 15 + 25 min', why: '看懂不算会。每天逼自己听写一段、复述十句，坚持下来口语和拼写会明显不一样。' },
        { tag: '工具', name: '欧路词典 / 有道词典', by: '免费 · 查词与生词本', why: '精读时遇到生词随手加进生词本，第二天专门复盘，别指望当场记住。' },
        { tag: '工具', name: 'Anki / 任意背词 App', by: '免费 · 间隔重复', why: '把每天 20 个新词录进去，它按遗忘曲线提醒你复习。不想装软件就用手写卡片，一样管用。' }
      ]
    }
  ];

  /* 出厂 sid：按位置确定，保证「不点任何东西直接刷新」进度也不会错位 */
  DEFAULT_TRACKS.forEach(function (t) {
    t.steps.forEach(function (st, i) {
      if (!st.sid) st.sid = t.id + '-' + (i + 1);
    });
  });

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function newUid(prefix) {
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function defaultPlan() {
    return {
      period: thisYearPeriod(),
      slots: clone(DEFAULT_SLOTS),
      tracks: clone(DEFAULT_TRACKS)
    };
  }


  /* ----------------------------------------------------------------
     State
     ---------------------------------------------------------------- */
  var STORE_KEY = 'study-plan-v2';

  var state = {
    sel: '',                   /* 选中的日期 YYYY-MM-DD */
    openMonths: null,          /* 日历里展开的月份 { 'YYYY-MM': true } */
    checks: {},
    reviews: {},
    notes: {},                 /* { [trackId]: [{ text, ts }] } */
    links: [],                 /* 资料仓库里的链接卡 */
    track: '',
    steps: {},                 /* { [trackId]: { [stepSid]: true } } */
    editing: false,
    lastExport: 0,             /* 上次导出 JSON 的时间戳 —— 用于「该备份了」提醒 */
    backupMuted: 0,            /* 用户手动关掉备份提醒的时间戳 */
    plan: defaultPlan()
  };

  /* 当前生效的计划 —— 永远从 state 读，不读常量 */
  function tracks() {
    return state.plan.tracks;
  }

  function trackById(id) {
    var list = tracks();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /* 补齐结构 + 保证 id / sid 唯一可用。任何来自 localStorage 或导入的计划都要先过这里。 */
  function normalizePlan() {
    if (!state.plan || typeof state.plan !== 'object') state.plan = defaultPlan();
    if (!Array.isArray(state.plan.tracks) || !state.plan.tracks.length) {
      state.plan.tracks = clone(DEFAULT_TRACKS);
    }

    /* ---- period ---- */
    var def = thisYearPeriod();
    var p = state.plan.period;
    if (!p || typeof p !== 'object') p = state.plan.period = def;
    if (!parseYmd(p.start)) p.start = def.start;
    if (!parseYmd(p.end)) p.end = def.end;
    if (parseYmd(p.end) < parseYmd(p.start)) {
      p.start = def.start;
      p.end = def.end;
    }
    if (!Array.isArray(p.restWeekdays)) p.restWeekdays = def.restWeekdays.slice();
    p.restWeekdays = p.restWeekdays
      .map(function (w) { return Number(w); })
      .filter(function (w) { return w >= 0 && w <= 6; })
      .filter(function (w, i, a) { return a.indexOf(w) === i; });
    if (!Array.isArray(p.extraRest)) p.extraRest = [];
    if (!Array.isArray(p.extraWork)) p.extraWork = [];
    p.extraRest = p.extraRest.filter(function (k) { return !!parseYmd(k); })
      .filter(function (k, i, a) { return a.indexOf(k) === i; });
    p.extraWork = p.extraWork.filter(function (k) { return !!parseYmd(k); })
      .filter(function (k, i, a) { return a.indexOf(k) === i; });

    /* ---- 每日作息 ---- */
    var s = state.plan.slots;
    if (!s || typeof s !== 'object') s = state.plan.slots = clone(DEFAULT_SLOTS);
    ['study', 'rest'].forEach(function (key) {
      if (!Array.isArray(s[key])) s[key] = clone(DEFAULT_SLOTS[key]);
      s[key] = s[key].filter(function (x) { return x && typeof x === 'object'; });
      var ids = {};
      s[key].forEach(function (x) {
        if (!x.id || ids[x.id]) x.id = newUid('sl');
        ids[x.id] = true;
        x.time = x.time || '';
        x.title = x.title || '未命名时段';
        x.desc = x.desc || '';
        if (SLOT_KINDS.indexOf(x.kind) < 0) x.kind = 'light';
      });
    });

    DAYS_CACHE = null;
    var seen = {};
    state.plan.tracks.forEach(function (t, ti) {
      if (!t || typeof t !== 'object') return;
      if (!t.id || seen[t.id]) t.id = newUid('t');
      seen[t.id] = true;
      t.name = t.name || ('未命名模块 ' + (ti + 1));
      t.meta = t.meta || '';
      t.title = t.title || '';
      t.sub = t.sub || '';
      t.ph = t.ph || '';
      if (!Array.isArray(t.steps)) t.steps = [];
      if (!Array.isArray(t.resources)) t.resources = [];
      var sids = {};
      t.steps.forEach(function (st, si) {
        if (!st || typeof st !== 'object') return;
        if (!st.sid || sids[st.sid]) st.sid = newUid('s');
        sids[st.sid] = true;
        st.date = st.date || '';
        st.phase = st.phase || '';
        st.title = st.title || ('第 ' + (si + 1) + ' 阶');
        st.desc = st.desc || '';
      });
      if (!state.steps[t.id] || typeof state.steps[t.id] !== 'object') state.steps[t.id] = {};
      if (!Array.isArray(state.notes[t.id])) state.notes[t.id] = [];
    });
  }

  /* 旧版本把进度按「第几阶」的数字存，升级后按 sid 存 —— 迁移一次，别丢用户数据 */
  function migrateNumericKeys(savedSteps) {
    tracks().forEach(function (t) {
      var from = savedSteps[t.id];
      if (!from || typeof from !== 'object') return;
      var to = state.steps[t.id] || (state.steps[t.id] = {});
      Object.keys(from).forEach(function (k) {
        if (/^\d+$/.test(k)) {
          var st = t.steps[Number(k) - 1];
          if (st) to[st.sid] = true;
        } else {
          to[k] = true;
        }
      });
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;

      if (saved.plan && Array.isArray(saved.plan.tracks) && saved.plan.tracks.length) {
        state.plan = clone(saved.plan);
      }

      /* 先把 trackId -> 旧数字键的映射留着，normalize 会重建 state.steps */
      var oldSteps = saved.steps && typeof saved.steps === 'object' ? saved.steps : null;
      state.steps = {};
      state.notes = {};
      normalizePlan();
      if (oldSteps) migrateNumericKeys(oldSteps);

      if (saved.notes && typeof saved.notes === 'object') {
        tracks().forEach(function (t) {
          if (Array.isArray(saved.notes[t.id])) state.notes[t.id] = saved.notes[t.id];
        });
      }
      if (saved.checks && typeof saved.checks === 'object') state.checks = saved.checks;
      if (saved.reviews && typeof saved.reviews === 'object') state.reviews = saved.reviews;
      if (Array.isArray(saved.links)) {
        state.links = saved.links.filter(function (l) {
          return l && typeof l === 'object' && typeof l.title === 'string' && typeof l.url === 'string';
        });
      }

      if (typeof saved.lastExport === 'number') state.lastExport = saved.lastExport;
      if (typeof saved.backupMuted === 'number') state.backupMuted = saved.backupMuted;

      if (saved.track && trackById(saved.track)) state.track = saved.track;
      if (typeof saved.sel === 'string' && indexOfDate(saved.sel) >= 0) state.sel = saved.sel;
      if (saved.openMonths && typeof saved.openMonths === 'object') state.openMonths = saved.openMonths;

      /* 一次性迁移：旧版本默认「周末双休」[0,6]，新版本改为不预设休息日。
         仅当 restWeekdays 恰好等于旧默认、且没有用户另加的调休学习日时，视为旧默认清空；
         用户自己编排过（勾掉过、或加过调休）的组合不会被误伤。
         放在 load 末尾（所有字段都恢复完）再 save，避免把未恢复的字段写空。 */
      if (saved.plan && saved.plan.period && Array.isArray(saved.plan.period.restWeekdays)) {
        var rw = saved.plan.period.restWeekdays.map(Number).sort();
        var isOldDefault = rw.length === 2 && rw[0] === 0 && rw[1] === 6;
        var hasCustomWork = Array.isArray(saved.plan.period.extraWork) && saved.plan.period.extraWork.length > 0;
        if (isOldDefault && !hasCustomWork) {
          state.plan.period.restWeekdays = [];
          save();
        }
      }
    } catch (e) {
      /* 隐私模式 / 配额满 —— 静默退回内存态 */
      state.steps = {};
      state.notes = {};
      normalizePlan();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        checks: state.checks,
        reviews: state.reviews,
        notes: state.notes,
        steps: state.steps,
        plan: state.plan,
        sel: state.sel,
        openMonths: state.openMonths,
        track: state.track,
        links: state.links,
        lastExport: state.lastExport,
        backupMuted: state.backupMuted
      }));
    } catch (e) {}
  }

  /* ----------------------------------------------------------------
     Helpers
     ---------------------------------------------------------------- */
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ==================================================================
     周期 → 天数列。日历 / 进度 / 时间轴全部由这里推导，
     页面里没有任何写死的日期。
     ================================================================== */
  var DAYS_CACHE = null;

  function period() {
    return state.plan.period || thisYearPeriod();
  }

  function invalidateDays() {
    DAYS_CACHE = null;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* 严格解析 YYYY-MM-DD —— 2026-02-30 这种必须挡掉，别让 Date 悄悄进位成 03-02 */
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]) - 1, da = Number(m[3]);
    var d = new Date(y, mo, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
    return d;
  }

  function days() {
    if (DAYS_CACHE) return DAYS_CACHE;

    var p = period();
    var s = parseYmd(p.start);
    var e = parseYmd(p.end);
    var out = [];
    if (!s || !e || e < s) { DAYS_CACHE = out; return out; }

    var restW = {}, extraRest = {}, extraWork = {};
    (p.restWeekdays || []).forEach(function (w) { restW[Number(w)] = true; });
    (p.extraRest || []).forEach(function (k) { extraRest[k] = true; });
    (p.extraWork || []).forEach(function (k) { extraWork[k] = true; });

    var cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var n = 0, guard = 0;
    /* 上限约 4 年 —— 防止手输错日期把页面卡死 */
    while (cur <= e && guard++ < 1500) {
      var key = ymd(cur);
      var wd = cur.getDay();
      var rest;
      if (extraWork[key]) rest = false;
      else if (extraRest[key]) rest = true;
      else rest = !!restW[wd];
      if (!rest) n++;
      out.push({
        d: key,
        wd: WEEK_CN[wd],
        dow: wd,
        rest: rest,
        n: rest ? 0 : n,
        tag: rest ? (extraRest[key] ? '假日' : '休') : '学习',
        title: rest ? '休息日（作息可自定义）' : ('学习日 · 第 ' + n + ' 天')
      });
      cur.setDate(cur.getDate() + 1);
    }

    DAYS_CACHE = out;
    return out;
  }

  function totalDays() {
    return days().length;
  }

  function totalStudy() {
    var a = days(), c = 0;
    for (var i = 0; i < a.length; i++) { if (!a[i].rest) c++; }
    return c;
  }

  function dayAt(i) {
    return days()[i] || null;
  }

  function indexOfDate(key) {
    var a = days();
    for (var i = 0; i < a.length; i++) { if (a[i].d === key) return i; }
    return -1;
  }

  function todayIndex() {
    return indexOfDate(todayKey());
  }

  function slotsOf(day) {
    var s = state.plan.slots || DEFAULT_SLOTS;
    return ((day && day.rest) ? s.rest : s.study) || [];
  }

  /* 打卡键用「日期」而不是「第几天」—— 周期一改，索引全变，只有日期是稳的 */
  function checkKey(dayKey, slotId) {
    return dayKey + ':' + slotId;
  }

  function isChecked(dayKey, slotId) {
    return !!state.checks[checkKey(dayKey, slotId)];
  }

  /** 一天算打卡完成：所有 kind = core 的时段都勾上；没有 core 就退化成「全勾」。 */
  function dayComplete(dayKey) {
    var i = indexOfDate(dayKey);
    if (i < 0) return false;
    var day = days()[i];
    if (day.rest) return false;
    var sl = slotsOf(day);
    if (!sl.length) return false;
    var core = sl.filter(function (x) { return x.kind === 'core'; });
    var list = core.length ? core : sl;
    for (var k = 0; k < list.length; k++) {
      if (!isChecked(dayKey, list[k].id)) return false;
    }
    return true;
  }

  function countStudyDone() {
    var a = days(), c = 0;
    for (var i = 0; i < a.length; i++) {
      if (dayComplete(a[i].d)) c++;
    }
    return c;
  }

  /* 累计打卡时段数 —— 不绑定任何具体科目，换成什么模版都算得对 */
  function countCheckedSlots() {
    var n = 0;
    Object.keys(state.checks).forEach(function (k) {
      if (state.checks[k] && indexOfDate(k.slice(0, 10)) >= 0) n++;
    });
    return n;
  }

  /** 连续打卡：从今天（或周期最后一天）往回走，休息日也算，断了就停。 */
  function streak() {
    var a = days();
    if (!a.length) return 0;
    var start = todayIndex();
    if (start < 0) start = a.length - 1;
    var s = 0;
    for (var i = start; i >= 0; i--) {
      if (a[i].rest) { s++; continue; }
      if (dayComplete(a[i].d)) { s++; continue; }
      break;
    }
    return s;
  }

  function el(id) {
    return document.getElementById(id);
  }

  /* ----------------------------------------------------------------
     Region 1 — stats count-up
     ---------------------------------------------------------------- */
  function initCounters() {
    var nums = document.querySelectorAll('.stat .num');
    if (!nums.length) return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function run(node, i) {
      var target = parseFloat(node.getAttribute('data-target'));
      var dec = parseInt(node.getAttribute('data-decimals'), 10) || 0;

      if (reduce) {
        node.textContent = target.toFixed(dec);
        return;
      }

      var duration = 1500 + i * 80;
      var delay = 480 + i * 90;

      setTimeout(function () {
        var t0 = null;
        function frame(ts) {
          if (t0 === null) t0 = ts;
          var p = Math.min((ts - t0) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
          node.textContent = (target * eased).toFixed(dec);
          if (p < 1) requestAnimationFrame(frame);
          else node.textContent = target.toFixed(dec);
        }
        requestAnimationFrame(frame);
      }, delay);
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var node = entry.target;
          run(node, Number(node.getAttribute('data-ci')) || 0);
          obs.unobserve(node);
        });
      }, { threshold: 0.25 });

      Array.prototype.forEach.call(nums, function (n, i) {
        n.setAttribute('data-ci', String(i));
        io.observe(n);
      });
    } else {
      Array.prototype.forEach.call(nums, function (n, i) {
        run(n, i);
      });
    }
  }

  /* ----------------------------------------------------------------
     Region 1 — 本地 Canvas 点阵背景
     原来是 CloudFront 上的背景视频，现在改成纯本地绘制：
     黑底 + 一片缓慢呼吸的点阵，从中心向外走一圈环形波。
     - 零外部请求、零额外体积，断网可用
     - prefers-reduced-motion: reduce → 只画一帧静态点阵，不跑动画
     - 标签页切到后台 / 首屏滚出视野 → 暂停，省电
     ---------------------------------------------------------------- */
  function initDotMatrix() {
    var cv = el('bgCanvas');
    if (!cv || !cv.getContext) return;

    var ctx = cv.getContext('2d');
    var reduce = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var dots = [];
    var W = 0, H = 0, cx = 0, cy = 0, maxD = 1;
    var raf = null, running = false, t0 = 0;

    function build() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth || window.innerWidth;
      H = cv.clientHeight || window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* 点阵密度：约每 26px 一个点。小屏自动稀一点，避免糊成一片 */
      var gap = Math.max(16, Math.round(Math.min(W, H) / 27));
      var cols = Math.ceil(W / gap) + 1;
      var rows = Math.ceil(H / gap) + 1;
      var ox = (W - (cols - 1) * gap) / 2;
      var oy = (H - (rows - 1) * gap) / 2;

      dots = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          dots.push({ x: ox + c * gap, y: oy + r * gap });
        }
      }

      cx = W / 2;
      cy = H * 0.44;                    /* 与标题重心对齐 */
      maxD = Math.sqrt(cx * cx + cy * cy) || 1;
    }

    function paint(ts) {
      ctx.clearRect(0, 0, W, H);

      var time = reduce ? 900 : (ts - t0);
      var BASE = 0.055;
      var AMP = 0.17;

      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        var dx = d.x - cx, dy = d.y - cy;
        var dist = Math.sqrt(dx * dx + dy * dy) / maxD;

        /* 从中心向外扩散的慢波 + 一点整体呼吸 */
        var w = Math.sin(dist * 5.4 - time * 0.00105);
        var breath = Math.sin(time * 0.00042) * 0.5;
        var e = (w + breath + 1.4) / 2.8;
        if (e < 0) e = 0; else if (e > 1) e = 1;
        e = e * e * (3 - 2 * e);        /* smoothstep：亮暗过渡更柔 */

        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.9 + e * 1.7, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,255,255,' + (BASE + e * AMP).toFixed(3) + ')';
        ctx.fill();
      }
    }

    function loop(ts) {
      if (!running) return;
      if (!t0) t0 = ts;
      paint(ts);
      raf = window.requestAnimationFrame(loop);
    }

    function start() {
      if (reduce || running) return;
      running = true;
      raf = window.requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (raf) { window.cancelAnimationFrame(raf); raf = null; }
    }

    build();
    if (reduce) paint(0);
    else start();

    var rz = null;
    window.addEventListener('resize', function () {
      if (rz) window.clearTimeout(rz);
      rz = window.setTimeout(function () {
        build();
        if (reduce) paint(0);
      }, 180);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else { t0 = 0; start(); }
    });

    if ('IntersectionObserver' in window) {
      var landing = document.querySelector('.landing');
      if (landing) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) start();
            else stop();
          });
        }, { threshold: 0.02 }).observe(landing);
      }
    }
  }

  /* ----------------------------------------------------------------
     Mobile menu
     ---------------------------------------------------------------- */
  function initMenu() {
    var burger = el('burger');
    var sheet = el('mobileMenu');
    var overlay = el('overlay');
    if (!burger || !sheet || !overlay) return;

    function open() {
      burger.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', '关闭菜单');
      sheet.hidden = false;
      overlay.hidden = false;
      document.body.classList.add('menu-open');
    }

    function close() {
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', '打开菜单');
      sheet.hidden = true;
      overlay.hidden = true;
      document.body.classList.remove('menu-open');
    }

    burger.addEventListener('click', function () {
      if (burger.classList.contains('is-open')) close();
      else open();
    });

    overlay.addEventListener('click', close);

    Array.prototype.forEach.call(sheet.querySelectorAll('a'), function (a) {
      a.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 720) close();
    });
  }

  /* ----------------------------------------------------------------
     Region 2 — scroll reveals
     ---------------------------------------------------------------- */
  function initReveals() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (n) { n.classList.add('is-in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    Array.prototype.forEach.call(items, function (n) { io.observe(n); });
  }

  /* ----------------------------------------------------------------
     Region 2 — 页面上的动态文案（标题 / 区间 / 图例 / 折叠提示）
     周期一改，这里全部跟着重算，页面里没有一处写死的日期。
     ---------------------------------------------------------------- */
  function renderHead() {
    var p = period();
    var all = totalDays();
    var study = totalStudy();
    var rest = all - study;
    var a = parseYmd(p.start), b = parseYmd(p.end);

    var title = el('planTitle');
    if (title) title.textContent = all ? (all + ' Days') : 'No Plan';

    var sub = el('planSub');
    if (sub) {
      sub.innerHTML = (a && b)
        ? esc(p.start) + ' &nbsp;→&nbsp; ' + esc(p.end) +
          ' &nbsp;·&nbsp; 共 <b>' + all + '</b> 天 &nbsp;·&nbsp; 学习 ' + study + ' 天 &nbsp;·&nbsp; 休息 ' + rest + ' 天'
        : '还没有设置周期 —— 点下面的「计划周期」选起止日期';
    }

    var lgStudy = el('lgStudy');
    if (lgStudy) lgStudy.innerHTML = '<i></i>学习 ' + study + ' 天';
    var lgRest = el('lgRest');
    if (lgRest) lgRest.innerHTML = '<i></i>休息 ' + rest + ' 天';

    var calTitle = el('calTitle');
    if (calTitle) {
      calTitle.textContent = all ? ('计划总览 · ' + all + ' 天') : '计划总览';
    }

    var brief = el('periodBrief');
    if (brief) {
      brief.textContent = (a && b)
        ? (p.start + ' → ' + p.end + ' · ' + all + ' 天')
        : '未设置';
    }

    var cue = el('cueText');
    if (cue) cue.textContent = all ? ('学习计划 · ' + all + ' 天') : '学习计划';

    var foot = el('footPeriod');
    if (foot) {
      foot.textContent = (a && b)
        ? ('当前周期：' + p.start + ' → ' + p.end + '，共 ' + all + ' 天（学习 ' + study + ' 天 + 休息 ' + rest + ' 天）。')
        : '当前还没有设置周期。';
    }
  }

  /* 一处改动 → 全量重画。改周期 / 导入了新计划之后调它。 */
  function renderAll() {
    renderHead();
    renderBoard();
    renderToday();
    renderCal();
    renderDay();
    renderTracks();
    renderBackupTip();
    renderStats();
    renderJournal();
  }

  /* ----------------------------------------------------------------
     Region 2 — progress board
     ---------------------------------------------------------------- */
  function renderBoard() {
    var tKey = todayKey();
    var idx = indexOfDate(tKey);
    var all = totalDays();
    var done = countStudyDone();

    var dayEl = el('mDay');
    if (dayEl) {
      if (idx >= 0) {
        dayEl.innerHTML = (idx + 1) + '<span class="mu">/' + all + '</span>';
      } else {
        dayEl.textContent = (!all || tKey < period().start) ? '未开始' : '已结束';
      }
    }

    var studyEl = el('mStudy');
    if (studyEl) studyEl.innerHTML = done + '<span class="mu">/' + totalStudy() + '</span>';

    var slotEl = el('mSlot');
    if (slotEl) slotEl.innerHTML = countCheckedSlots() + '<span class="mu">段</span>';

    var streakEl = el('mStreak');
    if (streakEl) streakEl.innerHTML = streak() + '<span class="mu">天</span>';
  }

  /* ----------------------------------------------------------------
     Region 2 — today bar
     ---------------------------------------------------------------- */
  function renderToday() {
    var bar = el('todayBar');
    if (!bar) return;

    var p = period();
    var tKey = todayKey();
    var idx = indexOfDate(tKey);

    if (idx < 0) {
      bar.innerHTML = '<span>今天不在计划周期内（' +
        esc(p.start.replace(/-/g, '.')) + ' – ' + esc(p.end.replace(/-/g, '.')) +
        '，共 ' + totalDays() + ' 天）</span>';
      return;
    }

    var day = days()[idx];
    var kind = day.rest ? '<b>休息日</b>' : '<b>学习日 · 第 ' + day.n + ' 天</b>';
    var parts = ['今天', '<span class="dot-sep"></span>',
      day.d.replace(/-/g, '.'), day.wd, '<span class="dot-sep"></span>', kind,
      '<span class="dot-sep"></span>', '<span>周期内第 ' + (idx + 1) + ' 天 / 共 ' + totalDays() + ' 天</span>'];

    bar.innerHTML = parts.join(' ');
  }

  /* ----------------------------------------------------------------
     Region 2 — calendar（按月分块，可折叠）
     ---------------------------------------------------------------- */
  function renderCal() {
    var wrap = el('cal');
    if (!wrap) return;

    var a = days();
    if (!a.length) {
      wrap.innerHTML = '<p class="cal-empty">周期不合法或起止日期为空 —— 点上面「计划周期」改一下。</p>';
      return;
    }

    var tKey = todayKey();

    /* 按月分组 */
    var months = [];
    var byKey = {};
    a.forEach(function (day, i) {
      var mk = day.d.slice(0, 7);
      if (!byKey[mk]) {
        byKey[mk] = { key: mk, items: [], study: 0, rest: 0 };
        months.push(byKey[mk]);
      }
      var m = byKey[mk];
      m.items.push({ day: day, i: i });
      if (day.rest) m.rest++; else m.study++;
    });

    /* 默认只展开「今天」所在的月；今天不在周期内就展开第一个月 */
    if (!state.openMonths || typeof state.openMonths !== 'object') {
      var open0 = {};
      var target = byKey[tKey.slice(0, 7)] ? tKey.slice(0, 7) : months[0].key;
      open0[target] = true;
      state.openMonths = open0;
    } else {
      /* 周期改了以后，把已经不存在的月份键清掉 */
      Object.keys(state.openMonths).forEach(function (k) {
        if (!byKey[k]) delete state.openMonths[k];
      });
      /* 第一次进来（表是空的）给个默认；用户手动全收起时不干涉 */
      if (!Object.keys(state.openMonths).length) {
        state.openMonths[byKey[tKey.slice(0, 7)] ? tKey.slice(0, 7) : months[0].key] = true;
      }
    }
    var open = state.openMonths;

    wrap.innerHTML = '';

    months.forEach(function (m) {
      var block = document.createElement('div');
      block.className = 'cal-month' + (open[m.key] ? ' is-open' : '');
      block.setAttribute('data-month', m.key);

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'cm-head';
      head.setAttribute('aria-expanded', open[m.key] ? 'true' : 'false');
      head.innerHTML =
        '<span class="cm-caret" aria-hidden="true"></span>' +
        '<span class="cm-name">' + m.key.slice(0, 4) + ' 年 ' + Number(m.key.slice(5)) + ' 月</span>' +
        '<span class="cm-stat">学习 ' + m.study + ' · 休息 ' + m.rest + '</span>';
      head.addEventListener('click', function () {
        open[m.key] = !open[m.key];
        renderCal();
      });
      block.appendChild(head);

      var body = document.createElement('div');
      body.className = 'cm-body';

      var wk = document.createElement('div');
      wk.className = 'cm-week';
      WEEK_CN.forEach(function (w) {
        var s = document.createElement('span');
        s.textContent = w.slice(1);
        wk.appendChild(s);
      });
      body.appendChild(wk);

      var grid = document.createElement('div');
      grid.className = 'cm-grid';

      /* 月初补位：1 号是周几就空几格 */
      var lead = parseYmd(m.items[0].day.d).getDay();
      for (var q = 0; q < lead; q++) {
        var ph = document.createElement('span');
        ph.className = 'cm-pad';
        grid.appendChild(ph);
      }

      m.items.forEach(function (rec) {
        var day = rec.day;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-cell ' + (day.rest ? 'is-rest' : 'is-study');
        if (day.d === tKey) b.classList.add('is-today');
        if (day.d === state.sel) b.classList.add('is-selected');
        if (dayComplete(day.d)) b.classList.add('is-done');
        b.setAttribute('data-date', day.d);
        b.setAttribute('aria-pressed', day.d === state.sel ? 'true' : 'false');
        b.setAttribute('aria-label', day.d + ' ' + day.wd + ' ' +
          (day.rest ? '休息日' : '学习日 第 ' + day.n + ' 天') +
          (day.d === tKey ? '（今天）' : '') + '，点击查看当天安排');
        b.innerHTML =
          '<span class="cc-d">' + Number(day.d.slice(8)) + '</span>' +
          '<span class="cc-tag">' + (day.rest ? '休' : day.n) + '</span>';

        b.addEventListener('click', function () {
          state.sel = day.d;
          renderCal();
          renderDay();
        });
        grid.appendChild(b);
      });

      body.appendChild(grid);
      block.appendChild(body);
      wrap.appendChild(block);
    });
  }

  /* ----------------------------------------------------------------
     Region 2 — selected day panel
     ---------------------------------------------------------------- */
  function renderDay() {
    var a = days();
    if (!a.length) return;

    var i = indexOfDate(state.sel);
    if (i < 0) {
      state.sel = a[0].d;
      i = 0;
    }
    var day = a[i];
    var tKey = todayKey();
    var slots = slotsOf(day);
    var templ = day.rest ? 'rest' : 'study';

    var kicker = el('dpKicker');
    if (kicker) {
      kicker.textContent = day.d.replace(/-/g, '.') + ' ' + day.wd +
        (day.d === tKey ? ' · 今天' : '') +
        (day.rest ? ' · 休息日' : ' · 学习日 第 ' + day.n + ' 天');
    }

    var titleEl = el('dpTitle');
    if (titleEl) {
      titleEl.textContent = day.rest ? '休息日 · 不排任务' : ('学习日 · 第 ' + day.n + ' 天');
    }

    var badge = el('dpBadge');
    if (badge) {
      badge.textContent = day.rest ? '休息' : '学习';
      badge.className = 'dp-badge' + (day.rest ? ' is-rest' : '');
    }

    /* ---- 时间轴（来自模版，学习日 / 休息日各一套） ---- */
    var head = el('tlHead');
    if (head) {
      head.innerHTML =
        '<span class="tlh-title">当天时间轴</span>' +
        '<span class="tlh-note">' +
          (day.rest ? '休息日模版' : '学习日模版') +
          ' · 所有' + (day.rest ? '休息日' : '学习日') + '共用' +
          (state.editing ? ' · 编辑中' : '') +
        '</span>';
    }

    var list = el('timeline');
    if (list) {
      list.innerHTML = '';

      if (!slots.length) {
        var empty = document.createElement('li');
        empty.className = 'tl-empty';
        empty.textContent = '这套模版还没有时段。' +
          (state.editing ? '点下面的「加一段」开始排。' : '点上面「编辑计划」就能加。');
        list.appendChild(empty);
      }

      slots.forEach(function (slot, si) {
        var li = document.createElement('li');
        li.className = 'tl-item is-' + slot.kind;
        if (isChecked(day.d, slot.id)) li.classList.add('is-done');
        li.setAttribute('data-sid', slot.id);

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'tl-check';
        cb.id = 'chk-' + day.d + '-' + slot.id;
        cb.checked = isChecked(day.d, slot.id);

        var time = document.createElement('span');
        time.className = 'tl-time';
        time.textContent = slot.time;

        var body = document.createElement('div');
        body.className = 'tl-body';

        var h = document.createElement('p');
        h.className = 'tl-title';
        h.textContent = slot.title;
        body.appendChild(h);

        if (slot.desc) {
          var p = document.createElement('p');
          p.className = 'tl-desc';
          p.textContent = slot.desc;
          body.appendChild(p);
        }

        cb.addEventListener('change', function () {
          var k = checkKey(day.d, slot.id);
          if (cb.checked) state.checks[k] = true;
          else delete state.checks[k];
          li.classList.toggle('is-done', cb.checked);
          save();
          renderBoard();
          renderCal();
        });

        /* 点整行也能勾 */
        li.addEventListener('click', function (e) {
          if (state.editing) return;
          if (e.target === cb || e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });

        li.appendChild(cb);
        li.appendChild(time);
        li.appendChild(body);

        if (state.editing) {
          var tools = document.createElement('div');
          tools.className = 'slot-tools';
          tools.innerHTML =
            '<button class="st-btn" type="button" data-slot-act="up" data-sid="' + esc(slot.id) + '"' +
              (si === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
            '<button class="st-btn" type="button" data-slot-act="down" data-sid="' + esc(slot.id) + '"' +
              (si === slots.length - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
            '<button class="st-btn" type="button" data-slot-act="edit" data-sid="' + esc(slot.id) + '" aria-label="编辑这一段">✎</button>' +
            '<button class="st-btn st-del" type="button" data-slot-act="del" data-sid="' + esc(slot.id) + '" aria-label="删除这一段">×</button>';
          li.appendChild(tools);
        }

        list.appendChild(li);
      });

      if (state.editing) {
        var addLi = document.createElement('li');
        addLi.className = 'tl-add-row';
        addLi.innerHTML = '<button class="step-add" type="button" data-slot-add="' + templ + '">＋ 给' +
          (day.rest ? '休息日' : '学习日') + '模版加一段</button>';
        list.appendChild(addLi);
      }
    }

    /* ---- 复盘（按日期存，周期改了也不串） ---- */
    var rv = state.reviews[day.d] || {};
    var doneEl = el('rvDone');
    var stuckEl = el('rvStuck');
    var nextEl = el('rvNext');
    if (doneEl) doneEl.value = rv.done || '';
    if (stuckEl) stuckEl.value = rv.stuck || '';
    if (nextEl) nextEl.value = rv.next || '';
  }

  /* ----------------------------------------------------------------
     Region 2 — review persistence
     ---------------------------------------------------------------- */
  function initReview() {
    var fields = [
      ['rvDone', 'done'],
      ['rvStuck', 'stuck'],
      ['rvNext', 'next']
    ];

    var hint = el('saveHint');
    var timer = null;

    function flash() {
      if (!hint) return;
      hint.classList.add('is-flash');
      hint.textContent = '已保存';
      clearTimeout(timer);
      timer = setTimeout(function () {
        hint.classList.remove('is-flash');
        hint.textContent = '随打随存，存在本机浏览器里';
      }, 1200);
    }

    fields.forEach(function (pair) {
      var node = el(pair[0]);
      if (!node) return;
      node.addEventListener('input', function () {
        var key = state.sel;
        if (!key) return;
        if (!state.reviews[key]) state.reviews[key] = {};
        state.reviews[key][pair[1]] = node.value;
        save();
        flash();
      });
    });
  }

  /* ----------------------------------------------------------------
     Region 2 — tracks (tab paging / step check-off / editing)
     ---------------------------------------------------------------- */
  function trackState(t) {
    if (!state.steps[t.id] || typeof state.steps[t.id] !== 'object') state.steps[t.id] = {};
    return state.steps[t.id];
  }

  function trackDone(t) {
    var s = trackState(t);
    var c = 0;
    for (var i = 0; i < t.steps.length; i++) {
      if (s[t.steps[i].sid]) c++;
    }
    return c;
  }

  /* Lightweight: refresh ONLY the progress readout on the tab buttons,
     so ticking a step never rebuilds the panels (would lose focus/scroll). */
  function renderTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.track-tab'), function (b) {
      var t = trackById(b.getAttribute('data-track'));
      if (!t) return;
      var done = trackDone(t);
      var pct = t.steps.length ? Math.round(done / t.steps.length * 100) : 0;
      var bar = b.querySelector('.tt-prog i');
      var num = b.querySelector('.tt-num');
      if (bar) bar.style.width = pct + '%';
      if (num) num.textContent = done + '/' + t.steps.length;
    });
  }

  /* 用户内容可以是导入来的，一律转义后再拼进 HTML */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function indexOfTrack(id) {
    var list = tracks();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return i; }
    return -1;
  }

  function indexOfStep(t, sid) {
    for (var i = 0; i < t.steps.length; i++) { if (t.steps[i].sid === sid) return i; }
    return -1;
  }

  /* 任务的「参考日期」如果正好落在周期里的学习日，附一个 D 序号；否则原样显示 */
  function dayLabel(date) {
    if (!date) return '';
    var a = days();
    for (var i = 0; i < a.length; i++) {
      var d = a[i];
      if (d.rest) continue;
      if (d.d === date || d.d.slice(5).replace('-', '/') === date) {
        return 'D' + d.n + ' · ' + date;
      }
    }
    return date;
  }

  function sheetHtml(code) {
    if (!code) return '';
    var acts = SHEET_MODES.map(function (m) {
      return '<a class="sheet-a" href="assets/dxf/' + esc(code) + '-' + m.k + '.dxf"' +
        ' download="' + esc(code) + '-' + m.cn + '.dxf" title="' + m.tip + '">' + m.cn + '</a>';
    }).join('');
    return '<div class="sheets">' +
      '<img class="sheet-thumb" src="assets/dxf/' + esc(code) + '-MO.png"' +
      ' alt="' + esc(code) + ' 摹图预览" loading="lazy" width="320" height="226">' +
      '<div class="sheet-side">' +
        '<p class="sheet-cap">同题四练</p>' +
        '<div class="sheet-acts">' + acts + '</div>' +
        '<p class="sheet-hint">摹带尺寸 · 临无尺寸 · 默只给尺寸 · 检标易错点</p>' +
      '</div>' +
    '</div>';
  }

  function stepToolsHtml(sid, i, len) {
    return '<div class="step-tools">' +
      '<button class="st-btn" type="button" data-act="up" data-sid="' + esc(sid) + '"' +
        (i === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
      '<button class="st-btn" type="button" data-act="down" data-sid="' + esc(sid) + '"' +
        (i === len - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
      '<button class="st-btn" type="button" data-act="edit" data-sid="' + esc(sid) + '" aria-label="编辑这一阶">✎</button>' +
      '<button class="st-btn st-del" type="button" data-act="del" data-sid="' + esc(sid) + '" aria-label="删除这一阶">×</button>' +
    '</div>';
  }

  function stepHtml(st, i, len) {
    var n = i + 1;
    return '<li class="step" data-sid="' + esc(st.sid) + '">' +
      '<button class="step-check" type="button" aria-pressed="false"' +
      ' aria-label="标记第 ' + n + ' 阶完成"></button>' +
      '<div class="step-body">' +
        '<p class="step-meta"><b>第 ' + n + ' 阶</b>' +
          (st.date ? '<span class="step-date">' + esc(dayLabel(st.date)) + '</span>' : '') +
          (st.phase ? '<em class="step-phase">' + esc(st.phase) + '</em>' : '') +
        '</p>' +
        '<p class="step-title">' + esc(st.title) + '</p>' +
        (st.desc ? '<p class="step-desc">' + esc(st.desc) + '</p>' : '') +
        sheetHtml(st.dxf) +
        (state.editing ? stepToolsHtml(st.sid, i, len) : '') +
      '</div>' +
    '</li>';
  }

  function goalHtml(t) {
    if (!t.goals || !t.goals.length) return '';
    var items = t.goals.map(function (g) {
      return '<article class="goal">' +
        '<p class="goal-value">' + esc(g.value) + '</p>' +
        '<p class="goal-label">' + esc(g.label) + '</p>' +
        '<p class="goal-hint">' + esc(g.hint) + '</p>' +
      '</article>';
    }).join('');
    return '<div class="goals"><p class="goals-cap">累计目标</p>' +
      '<div class="goal-grid">' + items + '</div></div>';
  }

  function resHtml(t) {
    if (!t.resources || !t.resources.length) return '';
    var items = t.resources.map(function (r) {
      return '<li class="res">' +
        '<div class="res-head"><span class="res-tag">' + esc(r.tag) + '</span>' +
        '<span class="res-name">' + esc(r.name) + '</span></div>' +
        '<p class="res-by">' + esc(r.by) + '</p>' +
        '<p class="res-why">' + esc(r.why) + '</p>' +
        (r.url ? '<a class="res-link" href="' + esc(r.url) +
          '" target="_blank" rel="noopener noreferrer">打开 &rarr;</a>' : '') +
      '</li>';
    }).join('');
    return '<div class="res-block">' +
      '<div class="res-block-head">' +
        '<h5 class="res-title">配套资源</h5>' +
        '<span class="res-count">' + t.resources.length + ' 条</span>' +
      '</div>' +
      '<ul class="res-list">' + items + '</ul>' +
    '</div>';
  }

  function noteHtml(t) {
    return '<div class="note-block">' +
      '<div class="note-block-head">' +
        '<h5 class="note-title">本线笔记</h5>' +
        '<span class="note-count"></span>' +
      '</div>' +
      '<div class="note-compose">' +
        '<textarea class="note-input" rows="3" placeholder="' + esc(t.ph) + '"></textarea>' +
        '<div class="note-actions">' +
          '<span class="note-hint">Ctrl / ⌘ + Enter 快速记一条</span>' +
          '<button class="note-add" type="button">记一条</button>' +
        '</div>' +
      '</div>' +
      '<ul class="note-list"></ul>' +
    '</div>';
  }

  function panelHtml(t, i, len) {
    var done = trackDone(t);
    var pct = t.steps.length ? Math.round(done / t.steps.length * 100) : 0;
    var body = t.steps.length
      ? '<ol class="steps">' + t.steps.map(function (st, si) { return stepHtml(st, si, t.steps.length); }).join('') + '</ol>'
      : '<p class="steps-empty">这条线还没有任务。点下面的「＋ 加一阶」开始排。</p>';
    return '<header class="tp-head">' +
        '<div class="tp-title-row">' +
          '<div>' +
            '<p class="tp-eyebrow">Track ' + pad(i + 1) + (len ? ' / ' + pad(len) : '') + '</p>' +
            '<h4 class="tp-title">' + esc(t.name) + (t.title ? ' · ' + esc(t.title) : '') + '</h4>' +
          '</div>' +
          '<div class="tp-prog">' +
            '<span class="tpp-num"><b>' + done + '</b> / ' + t.steps.length + '</span>' +
            '<span class="tpp-bar"><i style="width:' + pct + '%"></i></span>' +
          '</div>' +
        '</div>' +
        (t.sub ? '<p class="tp-sub">' + esc(t.sub) + '</p>' : '') +
      '</header>' +
      body +
      (state.editing
        ? '<div class="step-add-row"><button class="step-add" type="button" data-track="' +
          esc(t.id) + '">＋ 加一阶</button></div>'
        : '') +
      goalHtml(t) +
      resHtml(t) +
      noteHtml(t);
  }

  function tabToolsHtml(id, i, len) {
    return '<span class="tt-tools">' +
      '<button class="te" type="button" data-act="up" data-track="' + esc(id) + '"' +
        (i === 0 ? ' disabled' : '') + ' aria-label="前移">↑</button>' +
      '<button class="te" type="button" data-act="down" data-track="' + esc(id) + '"' +
        (i === len - 1 ? ' disabled' : '') + ' aria-label="后移">↓</button>' +
      '<button class="te" type="button" data-act="rename" data-track="' + esc(id) + '" aria-label="编辑模块">✎</button>' +
      '<button class="te te-del" type="button" data-act="del" data-track="' + esc(id) + '" aria-label="删除模块">×</button>' +
    '</span>';
  }

  function renderTracks() {
    var tabs = el('trackTabs');
    var panels = el('trackPanels');
    if (!tabs || !panels) return;

    var list = tracks();
    if (!trackById(state.track)) state.track = list[0].id;

    tabs.innerHTML = '';
    panels.innerHTML = '';

    list.forEach(function (t, i) {
      var done = trackDone(t);
      var pct = t.steps.length ? Math.round(done / t.steps.length * 100) : 0;
      var on = t.id === state.track;

      var b = document.createElement('div');
      b.className = 'track-tab' + (on ? ' is-active' : '') + (state.editing ? ' is-editing' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('tabindex', on ? '0' : '-1');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('data-track', t.id);
      b.innerHTML =
        '<span class="tt-idx">' + pad(i + 1) + '</span>' +
        '<span class="tt-main">' +
          '<span class="tt-name">' + esc(t.name) + '</span>' +
          '<span class="tt-meta">' + esc(t.meta) + '</span>' +
        '</span>' +
        '<span class="tt-prog"><i style="width:' + pct + '%"></i></span>' +
        '<span class="tt-num">' + done + '/' + t.steps.length + '</span>' +
        (state.editing ? tabToolsHtml(t.id, i, list.length) : '');
      b.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.tt-tools')) return;
        switchTrack(t.id);
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTrack(t.id); }
      });
      tabs.appendChild(b);

      var p = document.createElement('div');
      p.className = 'track-panel' + (on ? ' is-active' : '');
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('data-track', t.id);
      p.innerHTML = panelHtml(t, i, list.length);
      panels.appendChild(p);
      bindPanel(p, t);
    });

    if (state.editing) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'track-add';
      add.textContent = '＋ 新模块';
      add.addEventListener('click', function () { openTrackEditor(null); });
      tabs.appendChild(add);
    }
  }

  function switchTrack(id) {
    if (!trackById(id)) return;
    state.track = id;
    save();

    Array.prototype.forEach.call(document.querySelectorAll('.track-tab'), function (b) {
      var on = b.getAttribute('data-track') === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.track-panel'), function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-track') === id);
    });
  }

  function syncPanelProgress(p, t) {
    var done = trackDone(t);
    var pct = t.steps.length ? Math.round(done / t.steps.length * 100) : 0;
    var num = p.querySelector('.tpp-num b');
    var bar = p.querySelector('.tpp-bar i');
    if (num) num.textContent = done;
    if (bar) bar.style.width = pct + '%';
  }

  function bindPanel(p, t) {
    var s = trackState(t);

    Array.prototype.forEach.call(p.querySelectorAll('.step'), function (li) {
      var sid = li.getAttribute('data-sid');
      var btn = li.querySelector('.step-check');
      if (!sid || !btn) return;

      function sync() {
        var on = !!s[sid];
        li.classList.toggle('is-done', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      sync();

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (s[sid]) delete s[sid]; else s[sid] = true;
        sync();
        save();
        syncPanelProgress(p, t);
        renderTabs();
      });
    });

    bindNotes(p, t);
  }

  /* ----------------------------------------------------------------
     Region 2 — per-track notes (each panel keeps its own stream)
     ---------------------------------------------------------------- */
  function renderNoteList(p, t) {
    var list = p.querySelector('.note-list');
    var count = p.querySelector('.note-count');
    if (!list) return;

    var items = state.notes[t.id] || [];
    if (count) count.textContent = items.length ? items.length + ' 条' : '';

    list.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'note-empty';
      empty.textContent = '还没有 ' + t.name + ' 的笔记。看懂了就写一条，用自己的话。';
      list.appendChild(empty);
      return;
    }

    items.slice().reverse().forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'note-item';

      var text = document.createElement('p');
      text.textContent = item.text;
      li.appendChild(text);

      var when = document.createElement('time');
      when.textContent = item.ts;
      li.appendChild(when);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'note-del';
      del.setAttribute('aria-label', '删除这条笔记');
      del.textContent = '\u00d7';
      del.addEventListener('click', function () {
        var arr = state.notes[t.id];
        var at = arr.indexOf(item);
        if (at > -1) arr.splice(at, 1);
        save();
        renderNoteList(p, t);
      });
      li.appendChild(del);

      list.appendChild(li);
    });
  }

  function bindNotes(p, t) {
    var input = p.querySelector('.note-input');
    var add = p.querySelector('.note-add');
    var hint = p.querySelector('.note-hint');
    if (!input || !add) return;

    var timer = null;
    function flash(msg) {
      if (!hint) return;
      hint.classList.add('is-flash');
      hint.textContent = msg;
      clearTimeout(timer);
      timer = setTimeout(function () {
        hint.classList.remove('is-flash');
        hint.textContent = 'Ctrl / ⌘ + Enter 快速记一条';
      }, 1400);
    }

    function submit() {
      var text = input.value.trim();
      if (!text) { flash('写点东西再记'); return; }
      if (!Array.isArray(state.notes[t.id])) state.notes[t.id] = [];
      var d = new Date();
      state.notes[t.id].push({
        text: text,
        ts: pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes())
      });
      input.value = '';
      save();
      renderNoteList(p, t);
      flash('已记入 ' + t.name);
    }

    add.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    renderNoteList(p, t);
  }

  /* ----------------------------------------------------------------
     Region 3 — 自定义：编辑模式 / 模块与任务增删改 / JSON 导入导出
     ---------------------------------------------------------------- */
  var TRACK_FIELDS = [
    { k: 'name', label: '模块名', ph: '例如：数据结构' },
    { k: 'meta', label: '标签上的小字', ph: '例如：10 阶 · 每天 1 h' },
    { k: 'title', label: '面板标题', ph: '例如：制图渐进大纲' },
    { k: 'sub', label: '面板说明', ph: '两三句说清这条线怎么走', multi: true },
    { k: 'ph', label: '笔记框提示语', ph: '例如：今天搞懂了链表插入。' }
  ];

  var STEP_FIELDS = [
    { k: 'date', label: '参考日期（可留空）', ph: 'MM/DD 或 YYYY-MM-DD，留空则不显示' },
    { k: 'phase', label: '阶段标签', ph: '例如：基础 / 流程 / 进阶' },
    { k: 'title', label: '任务标题', ph: '一句话说清今天做什么' },
    { k: 'desc', label: '任务说明', ph: '具体到用什么资源、做到什么程度算过', multi: true }
  ];

  var modalSubmit = null;
  var toolsTimer = null;

  /* ---------- 模态框（自己实现，不用 window.confirm，便于自动化测试） ---------- */
  function ensureModal() {
    if (el('modal')) return;
    var wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'modal';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
        '<header class="modal-head">' +
          '<h3 class="modal-title" id="modalTitle"></h3>' +
          '<button class="modal-x" type="button" id="modalX" aria-label="关闭">\u00d7</button>' +
        '</header>' +
        '<div class="modal-body" id="modalBody"></div>' +
        '<footer class="modal-foot">' +
          '<button class="mb mb-ghost" type="button" id="modalCancel">取消</button>' +
          '<button class="mb mb-primary" type="button" id="modalOk">保存</button>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(); });
    el('modalX').addEventListener('click', closeModal);
    el('modalCancel').addEventListener('click', closeModal);
    el('modalOk').addEventListener('click', function () { if (modalSubmit) modalSubmit(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = el('modal');
        if (m && !m.hidden) closeModal();
      }
    });
  }

  function closeModal() {
    var m = el('modal');
    if (m) m.hidden = true;
    modalSubmit = null;
  }

  function modalError(msg) {
    var e2 = el('modalErr');
    if (e2) { e2.textContent = msg; e2.classList.add('is-on'); }
  }

  function openForm(title, fields, values, onSubmit, okText) {
    ensureModal();
    modalSubmit = null;
    el('modalTitle').textContent = title;
    el('modalOk').textContent = okText || '保存';
    el('modalOk').className = 'mb mb-primary';
    el('modalBody').innerHTML = fields.map(function (f) {
      var id = 'mf-' + f.k;
      var input;
      if (f.options) {
        input = '<select class="mf-input" id="' + id + '">' + f.options.map(function (o) {
          return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>';
        }).join('') + '</select>';
      } else if (f.multi) {
        input = '<textarea class="mf-input" id="' + id + '" rows="4" placeholder="' + esc(f.ph || '') + '"></textarea>';
      } else {
        input = '<input class="mf-input" id="' + id + '" type="text" placeholder="' + esc(f.ph || '') + '">';
      }
      return '<label class="mf"><span class="mf-label">' + esc(f.label) + '</span>' + input + '</label>';
    }).join('') + '<p class="modal-err" id="modalErr"></p>';

    fields.forEach(function (f) {
      var inp = el('mf-' + f.k);
      if (inp) inp.value = values[f.k] == null ? '' : values[f.k];
    });

    modalSubmit = function () {
      var out = {};
      fields.forEach(function (f) {
        var inp = el('mf-' + f.k);
        out[f.k] = inp ? inp.value.trim() : '';
      });
      if (onSubmit(out) !== false) closeModal();
    };

    el('modal').hidden = false;
    var first = el('modalBody') ? el('modalBody').querySelector('.mf-input') : null;
    if (first) first.focus();
  }

  function openConfirm(title, msg, onOk) {
    ensureModal();
    modalSubmit = null;
    el('modalTitle').textContent = title;
    el('modalOk').textContent = '确认';
    el('modalOk').className = 'mb mb-danger';
    el('modalBody').innerHTML = '<p class="modal-msg">' + esc(msg) + '</p>';
    modalSubmit = function () { onOk(); closeModal(); };
    el('modal').hidden = false;
  }

  /* ---------- 工具栏提示 ---------- */
  function flashTools(msg) {
    var h = el('toolsHint');
    if (!h) return;
    h.textContent = msg;
    h.classList.add('is-flash');
    clearTimeout(toolsTimer);
    toolsTimer = setTimeout(function () {
      h.classList.remove('is-flash');
      h.textContent = state.editing
        ? '编辑模式：点模块 / 任务 / 时段上的 ✎ 改内容，↑ ↓ 调顺序，× 删除。周期在「计划周期」里改。'
        : '';
    }, 3000);
  }

  function toggleEdit() {
    state.editing = !state.editing;
    var b = el('editToggle');
    if (b) {
      b.setAttribute('aria-pressed', state.editing ? 'true' : 'false');
      b.classList.toggle('is-on', state.editing);
      b.textContent = state.editing ? '✓ 退出编辑' : '✎ 编辑计划';
    }
    var tools = el('trackTools');
    if (tools) tools.classList.toggle('is-editing', state.editing);
    renderTracks();
    renderDay();          /* 时间轴也要跟着进出编辑态（每段右边会多出 ↑↓✎×） */
    flashTools(state.editing ? '编辑模式已开启' : '已退出编辑模式');
  }

  /* ---------- 模块 / 任务 编辑 ---------- */
  /* 新任务的参考日期：从周期里挑第一个还没被用掉的学习日 */
  function suggestDate(t) {
    var used = {};
    t.steps.forEach(function (s) { used[s.date] = true; });
    var a = days();
    for (var i = 0; i < a.length; i++) {
      if (a[i].rest) continue;
      var md = a[i].d.slice(5).replace('-', '/');
      if (!used[md]) return md;
    }
    return '';
  }

  function openTrackEditor(t) {
    var isNew = !t;
    var base = t || { name: '', meta: '', title: '', sub: '', ph: '' };
    openForm(isNew ? '新建模块' : '编辑模块', TRACK_FIELDS, base, function (v) {
      if (!v.name) { modalError('模块名不能为空'); return false; }
      if (isNew) {
        var nt = {
          id: newUid('t'), name: v.name, meta: v.meta, title: v.title,
          sub: v.sub, ph: v.ph, steps: [], resources: []
        };
        tracks().push(nt);
        state.steps[nt.id] = {};
        state.notes[nt.id] = [];
        state.track = nt.id;
        save();
        renderTracks();
        flashTools('已新建「' + v.name + '」');
      } else {
        t.name = v.name; t.meta = v.meta; t.title = v.title;
        t.sub = v.sub; t.ph = v.ph;
        save();
        renderTracks();
        flashTools('已保存「' + v.name + '」');
      }
    }, isNew ? '创建' : '保存');
  }

  function openStepEditor(trackId, sid) {
    var t = trackById(trackId);
    if (!t) return;
    var i = sid ? indexOfStep(t, sid) : -1;
    var isNew = i < 0;
    var base = isNew
      ? { date: suggestDate(t), phase: '', title: '', desc: '' }
      : t.steps[i];
    openForm(isNew ? '新建任务' : '编辑任务', STEP_FIELDS, base, function (v) {
      if (!v.title) { modalError('任务标题不能为空'); return false; }
      if (isNew) {
        t.steps.push({ sid: newUid('s'), date: v.date, phase: v.phase, title: v.title, desc: v.desc });
        flashTools('已加一阶');
      } else {
        var st = t.steps[i];
        st.date = v.date; st.phase = v.phase; st.title = v.title; st.desc = v.desc;
        flashTools('已保存');
      }
      save();
      renderTracks();
    }, isNew ? '添加' : '保存');
  }

  function moveTrack(id, dir) {
    var list = tracks();
    var i = indexOfTrack(id);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    save();
    renderTracks();
  }

  function moveStep(trackId, sid, dir) {
    var t = trackById(trackId);
    if (!t) return;
    var i = indexOfStep(t, sid);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= t.steps.length) return;
    var tmp = t.steps[i]; t.steps[i] = t.steps[j]; t.steps[j] = tmp;
    save();
    renderTracks();
  }

  function deleteTrack(id) {
    var list = tracks();
    var t = trackById(id);
    if (!t) return;
    if (list.length <= 1) { flashTools('至少要留一条线，不能删光'); return; }
    openConfirm('删除模块', '删除「' + t.name + '」？它的 ' + t.steps.length +
      ' 个任务和本线笔记会一起删掉，不能撤销。', function () {
      var i = indexOfTrack(id);
      list.splice(i, 1);
      delete state.steps[id];
      delete state.notes[id];
      if (state.track === id) state.track = list[Math.min(i, list.length - 1)].id;
      save();
      renderTracks();
      flashTools('已删除「' + t.name + '」');
    });
  }

  function deleteStep(trackId, sid) {
    var t = trackById(trackId);
    if (!t) return;
    var i = indexOfStep(t, sid);
    if (i < 0) return;
    var title = t.steps[i].title;
    openConfirm('删除任务', '删除「' + title + '」这一阶？', function () {
      t.steps.splice(i, 1);
      if (state.steps[trackId]) delete state.steps[trackId][sid];
      save();
      renderTracks();
      flashTools('已删除一阶');
    });
  }

  /* ---------- 每日时段（作息模版）编辑 ---------- */
  var SLOT_FIELDS = [
    { k: 'time', label: '时间', ph: '例如：09:00 – 11:00 / 上午 / 21:00 之后' },
    { k: 'title', label: '这一段做什么', ph: '例如：主线一 · 最需要专注的那门' },
    { k: 'desc', label: '备注', ph: '写清这一段具体怎么用，可以留空', multi: true },
    {
      k: 'kind', label: '类型', options: [
        { v: 'core', t: '主线 —— 勾完才算这天打卡完成' },
        { v: 'light', t: '轻量 —— 只是提醒，不算完成度' },
        { v: 'rest', t: '自由 —— 不排任务的时间' },
        { v: 'ritual', t: '作息 —— 起床 / 睡觉这类固定动作' }
      ]
    }
  ];

  function indexOfSlot(list, sid) {
    for (var i = 0; i < list.length; i++) { if (list[i].id === sid) return i; }
    return -1;
  }

  function templName(templ) {
    return templ === 'rest' ? '休息日' : '学习日';
  }

  function openSlotEditor(templ, sid) {
    if (!state.plan.slots) state.plan.slots = clone(DEFAULT_SLOTS);
    if (!Array.isArray(state.plan.slots[templ])) state.plan.slots[templ] = clone(DEFAULT_SLOTS[templ]);
    var list = state.plan.slots[templ];

    var i = sid ? indexOfSlot(list, sid) : -1;
    var isNew = i < 0;
    var base = isNew ? { time: '', title: '', desc: '', kind: 'light' } : list[i];

    openForm((isNew ? '新增时段' : '编辑时段') + ' · ' + templName(templ) + '模版',
      SLOT_FIELDS, base, function (v) {
        if (!v.title) { modalError('这一段做什么，必须填'); return false; }
        var kind = SLOT_KINDS.indexOf(v.kind) >= 0 ? v.kind : 'light';
        if (isNew) {
          list.push({ id: newUid('sl'), time: v.time, title: v.title, desc: v.desc, kind: kind });
          flashTools('已给' + templName(templ) + '模版加一段');
        } else {
          var s = list[i];
          s.time = v.time; s.title = v.title; s.desc = v.desc; s.kind = kind;
          flashTools('已保存这一段');
        }
        save();
        renderDay();
        renderBoard();
        renderCal();
      }, isNew ? '添加' : '保存');
  }

  function moveSlot(templ, sid, dir) {
    var list = state.plan.slots && state.plan.slots[templ];
    if (!Array.isArray(list)) return;
    var i = indexOfSlot(list, sid);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    save();
    renderDay();
  }

  function deleteSlot(templ, sid) {
    var list = state.plan.slots && state.plan.slots[templ];
    if (!Array.isArray(list)) return;
    var i = indexOfSlot(list, sid);
    if (i < 0) return;
    var title = list[i].title;
    var gone = list[i].id;
    openConfirm('删除时段', '从' + templName(templ) + '模版里删掉「' + title + '」？' +
      '所有' + templName(templ) + '都会少这一段，这一段上已经打过的勾会一起清掉。', function () {
      list.splice(i, 1);
      var suffix = ':' + gone;
      Object.keys(state.checks).forEach(function (k) {
        if (k.slice(-suffix.length) === suffix) delete state.checks[k];
      });
      save();
      renderDay();
      renderBoard();
      renderCal();
      flashTools('已删除「' + title + '」');
    });
  }

  /* ---------- 计划周期（可自定义：几天 / 一学期 / 一整年） ---------- */
  var pdDraft = null;

  function countDaysOf(p) {
    var out = { all: 0, study: 0, rest: 0 };
    var s = parseYmd(p.start), e = parseYmd(p.end);
    if (!s || !e || e < s) return out;
    var restW = {}, exR = {}, exW = {};
    (p.restWeekdays || []).forEach(function (w) { restW[Number(w)] = true; });
    (p.extraRest || []).forEach(function (k) { exR[k] = true; });
    (p.extraWork || []).forEach(function (k) { exW[k] = true; });
    var cur = new Date(s.getFullYear(), s.getMonth(), s.getDate()), guard = 0;
    while (cur <= e && guard++ < 1500) {
      var key = ymd(cur);
      var rest = exW[key] ? false : (exR[key] ? true : !!restW[cur.getDay()]);
      out.all++;
      if (rest) out.rest++; else out.study++;
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function openPeriod() {
    var p = period();
    pdDraft = {
      start: p.start,
      end: p.end,
      restWeekdays: (p.restWeekdays || []).slice(),
      extraRest: (p.extraRest || []).slice(),
      extraWork: (p.extraWork || []).slice()
    };
    var panel = el('periodPanel');
    if (panel) panel.hidden = false;
    var btn = el('periodToggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    renderPeriod();
  }

  function closePeriod() {
    var panel = el('periodPanel');
    if (panel) panel.hidden = true;
    var btn = el('periodToggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    pdDraft = null;
  }

  function renderPdList(id, list, kind) {
    var box = el(id);
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      var em = document.createElement('span');
      em.className = 'pd-empty';
      em.textContent = kind === 'rest' ? '还没有额外休息日' : '还没有调休学习日';
      box.appendChild(em);
      return;
    }
    list.slice().sort().forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'pd-tag';
      var txt = document.createElement('span');
      txt.textContent = k;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'pd-tag-x';
      x.setAttribute('data-pd-del', kind);
      x.setAttribute('data-pd-key', k);
      x.setAttribute('aria-label', '移除 ' + k);
      x.textContent = '\u00d7';
      chip.appendChild(txt);
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function renderPeriodStat() {
    var out = el('periodStat');
    if (!out || !pdDraft) return;
    var n = countDaysOf(pdDraft);
    if (!n.all) {
      out.innerHTML = '日期区间不合法 —— 结束日期不能早于开始日期';
      return;
    }
    out.innerHTML = '共 <b>' + n.all + '</b> 天 &nbsp;·&nbsp; 学习 <b>' + n.study +
      '</b> 天 &nbsp;·&nbsp; 休息 <b>' + n.rest + '</b> 天';
  }

  function renderPeriod() {
    if (!pdDraft) return;

    var s = el('pdStart'), e = el('pdEnd');
    if (s) s.value = pdDraft.start;
    if (e) e.value = pdDraft.end;

    var wk = el('pdWeek');
    if (wk) {
      wk.innerHTML = '';
      WEEK_CN.forEach(function (name, i) {
        var lab = document.createElement('label');
        lab.className = 'pd-wk';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = String(i);
        cb.checked = pdDraft.restWeekdays.indexOf(i) >= 0;
        cb.addEventListener('change', function () {
          var k = pdDraft.restWeekdays.indexOf(i);
          if (cb.checked && k < 0) pdDraft.restWeekdays.push(i);
          if (!cb.checked && k >= 0) pdDraft.restWeekdays.splice(k, 1);
          renderPeriodStat();
        });
        var sp = document.createElement('span');
        sp.textContent = name;
        lab.appendChild(cb);
        lab.appendChild(sp);
        wk.appendChild(lab);
      });
    }

    renderPdList('pdRestList', pdDraft.extraRest, 'rest');
    renderPdList('pdWorkList', pdDraft.extraWork, 'work');
    renderPeriodStat();
  }

  /* 快捷区间：全部按「今天」现算，不写死任何年份 */
  function quickPeriod(kind) {
    if (!pdDraft) return;
    var t = new Date();
    var y = t.getFullYear();
    if (kind === 'thisYear') {
      pdDraft.start = y + '-01-01';
      pdDraft.end = y + '-12-31';
    } else if (kind === 'nextYear') {
      pdDraft.start = (y + 1) + '-01-01';
      pdDraft.end = (y + 1) + '-12-31';
    } else if (kind === 'thisMonth') {
      var first = new Date(y, t.getMonth(), 1);
      var last = new Date(y, t.getMonth() + 1, 0);
      pdDraft.start = ymd(first);
      pdDraft.end = ymd(last);
    } else if (kind === 'season') {
      /* 学年：今年 9 月 1 日 → 明年 8 月 31 日（开学日已过则顺延一年） */
      var sy = (t.getMonth() + 1 >= 9) ? y : y - 1;
      pdDraft.start = sy + '-09-01';
      pdDraft.end = (sy + 1) + '-08-31';
    } else if (kind === 'quarter') {
      var cur = new Date(y, t.getMonth(), t.getDate());
      var later = new Date(y, t.getMonth(), t.getDate() + 89);
      pdDraft.start = ymd(cur);
      pdDraft.end = ymd(later);
    }
    renderPeriod();
  }

  function addPdDate(kind) {
    if (!pdDraft) return;
    var inp = el(kind === 'rest' ? 'pdRestDate' : 'pdWorkDate');
    var v = inp ? inp.value : '';
    if (!parseYmd(v)) { flashTools('先用日历选一个日期'); return; }
    var list = kind === 'rest' ? pdDraft.extraRest : pdDraft.extraWork;
    if (list.indexOf(v) < 0) list.push(v);
    /* 同一天不能既是额外休息日又是调休学习日，后加的说了算 */
    var other = kind === 'rest' ? pdDraft.extraWork : pdDraft.extraRest;
    var oi = other.indexOf(v);
    if (oi >= 0) other.splice(oi, 1);
    if (inp) inp.value = '';
    renderPeriod();
  }

  function removePdDate(kind, key) {
    if (!pdDraft) return;
    var list = kind === 'rest' ? pdDraft.extraRest : pdDraft.extraWork;
    var i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    renderPeriod();
  }

  function applyPeriod() {
    if (!pdDraft) return;
    var s = el('pdStart'), e = el('pdEnd');
    if (s) pdDraft.start = s.value;
    if (e) pdDraft.end = e.value;

    if (!parseYmd(pdDraft.start) || !parseYmd(pdDraft.end)) {
      flashTools('日期没选全，起止都要填');
      return;
    }
    if (parseYmd(pdDraft.end) < parseYmd(pdDraft.start)) {
      flashTools('结束日期不能早于开始日期');
      return;
    }

    var p = period();
    p.start = pdDraft.start;
    p.end = pdDraft.end;
    p.restWeekdays = pdDraft.restWeekdays.slice();
    p.extraRest = pdDraft.extraRest.slice();
    p.extraWork = pdDraft.extraWork.slice();
    invalidateDays();

    var a = days();
    if (indexOfDate(state.sel) < 0) state.sel = a.length ? a[0].d : '';

    /* 已经不存在的月份，从「展开」表里清掉 */
    if (state.openMonths) {
      var alive = {};
      a.forEach(function (d) { alive[d.d.slice(0, 7)] = true; });
      Object.keys(state.openMonths).forEach(function (k) {
        if (!alive[k]) delete state.openMonths[k];
      });
    }

    save();
    closePeriod();
    renderAll();
    flashTools('周期已更新：' + p.start + ' → ' + p.end + '，共 ' + totalDays() +
      ' 天（学习 ' + totalStudy() + ' 天）');
  }

  /* ---------- 导出 / 导入 / 恢复默认 ---------- */
  function stampNow() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function exportPlan() {
    var payload = {
      app: 'study-website',
      schema: 1,
      exportedAt: new Date().toISOString(),
      plan: state.plan,
      checks: state.checks,
      reviews: state.reviews,
      notes: state.notes,
      steps: state.steps,
      links: state.links
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'study-plan-' + stampNow() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    /* 记下这次导出时间，备份提醒据此判断「多久没导了」 */
    state.lastExport = Date.now();
    save();
    renderBackupTip();

    flashTools('已导出 JSON —— 存好，可以分享给同学，也能再导入回来');
  }

  function validateImport(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '文件内容不是一个 JSON 对象。';
    var p = (obj.plan && typeof obj.plan === 'object') ? obj.plan : obj;
    if (!Array.isArray(p.tracks) || !p.tracks.length) return '找不到 tracks 数组，或者数组是空的。';
    for (var i = 0; i < p.tracks.length; i++) {
      var t = p.tracks[i];
      if (!t || typeof t !== 'object' || Array.isArray(t)) return '第 ' + (i + 1) + ' 个模块不是对象。';
      if (!t.name || typeof t.name !== 'string') return '第 ' + (i + 1) + ' 个模块缺少 name 字段。';
      if (t.steps != null && !Array.isArray(t.steps)) return '模块「' + t.name + '」的 steps 不是数组。';
      if (t.resources != null && !Array.isArray(t.resources)) return '模块「' + t.name + '」的 resources 不是数组。';
    }
    return null;
  }

  function applyImport(obj) {
    var p = (obj.plan && obj.plan.tracks) ? obj.plan : obj;
    /* 周期和作息模版也要一起导入 —— 少了它们，别人的计划换台电脑就变样了 */
    state.plan = {
      tracks: clone(p.tracks),
      period: (p.period && typeof p.period === 'object') ? clone(p.period) : thisYearPeriod(),
      slots: (p.slots && typeof p.slots === 'object') ? clone(p.slots) : clone(DEFAULT_SLOTS)
    };
    state.steps = {};
    state.notes = {};
    state.openMonths = null;
    normalizePlan();

    if (obj.steps && typeof obj.steps === 'object') {
      tracks().forEach(function (t) {
        var src = obj.steps[t.id];
        if (!src || typeof src !== 'object') return;
        var to = state.steps[t.id];
        Object.keys(src).forEach(function (k) { if (src[k] === true) to[k] = true; });
      });
    }
    if (obj.notes && typeof obj.notes === 'object') {
      tracks().forEach(function (t) {
        if (!Array.isArray(obj.notes[t.id])) return;
        state.notes[t.id] = obj.notes[t.id].filter(function (n) {
          return n && typeof n.text === 'string';
        });
      });
    }
    if (obj.checks && typeof obj.checks === 'object') state.checks = obj.checks;
    if (obj.reviews && typeof obj.reviews === 'object') state.reviews = obj.reviews;
    if (Array.isArray(obj.links)) {
      state.links = obj.links.filter(function (l) {
        return l && typeof l === 'object' && typeof l.title === 'string' && typeof l.url === 'string';
      });
    }

    state.track = tracks()[0].id;
    var a = days();
    if (indexOfDate(state.sel) < 0) state.sel = a.length ? a[0].d : '';

    save();
    renderAll();
    renderLib();
    flashTools('已导入 ' + tracks().length + ' 个模块 · 周期 ' +
      totalDays() + ' 天（' + period().start + ' → ' + period().end + '）' +
      (state.links.length ? ' · 资料链接 ' + state.links.length + ' 条' : ''));
  }

  function onImportFile(e) {
    var input = e.target;
    var f = input.files && input.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try {
        obj = JSON.parse(String(reader.result));
      } catch (err) {
        openConfirm('导入失败', '这个文件不是有效的 JSON：' + err.message, function () {});
        input.value = '';
        return;
      }
      var bad = validateImport(obj);
      if (bad) {
        openConfirm('导入失败', bad, function () {});
        input.value = '';
        return;
      }
      var p = (obj.plan && obj.plan.tracks) ? obj.plan : obj;
      openConfirm('确认导入', '将用文件里的 ' + p.tracks.length +
        ' 个模块替换当前计划，你现在的模块、勾选进度和笔记会被覆盖。建议先「导出」一份备份。', function () {
        applyImport(obj);
      });
      input.value = '';
    };
    reader.onerror = function () {
      openConfirm('导入失败', '读取文件时出错，换一个文件再试。', function () {});
      input.value = '';
    };
    reader.readAsText(f);
  }

  function resetPlan() {
    openConfirm('恢复默认计划', '会用内置的起步模板替换全部内容（四条学习线 + 周期回到今年一整年），' +
      '你改过的模块、周期、勾选进度和笔记都会清空。' +
      '这一步不能撤销 —— 建议先「导出」一份备份。', function () {
      state.plan = defaultPlan();
      state.steps = {};
      state.notes = {};
      state.checks = {};
      state.reviews = {};
      state.links = [];
      state.openMonths = null;
      normalizePlan();
      state.track = tracks()[0].id;
      var a0 = days();
      state.sel = todayIndex() >= 0 ? todayKey() : (a0[0] ? a0[0].d : '');
      save();
      renderAll();
      renderLib();
      flashTools('已恢复默认计划（本机上传的文件没动，需要的话在下面逐个删）');
    });
  }

  /* ---------- 事件委托（容器只装一次，渲染替换 innerHTML 也不会失效） ---------- */
  function initTrackTools() {
    var tabs = el('trackTabs');
    var panels = el('trackPanels');
    var tools = el('trackTools');
    var file = el('planFile');

    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn || !btn.closest('.tt-tools')) return;
        var act = btn.getAttribute('data-act');
        var id = btn.getAttribute('data-track');
        if (act === 'up') moveTrack(id, -1);
        else if (act === 'down') moveTrack(id, 1);
        else if (act === 'rename') openTrackEditor(trackById(id));
        else if (act === 'del') deleteTrack(id);
      });
    }

    if (panels) {
      panels.addEventListener('click', function (e) {
        var hit = e.target && e.target.closest
          ? e.target.closest('[data-act], .step-add') : null;
        if (!hit) return;
        if (hit.classList.contains('step-add')) {
          openStepEditor(hit.getAttribute('data-track'), null);
          return;
        }
        var panel = hit.closest('.track-panel');
        var tid = panel && panel.getAttribute('data-track');
        var sid = hit.getAttribute('data-sid');
        var act = hit.getAttribute('data-act');
        if (act === 'up') moveStep(tid, sid, -1);
        else if (act === 'down') moveStep(tid, sid, 1);
        else if (act === 'edit') openStepEditor(tid, sid);
        else if (act === 'del') deleteStep(tid, sid);
      });
    }

    if (tools) {
      tools.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-tool]') : null;
        if (!btn) return;
        var k = btn.getAttribute('data-tool');
        if (k === 'edit') toggleEdit();
        else if (k === 'export') exportPlan();
        else if (k === 'import') { if (file) file.click(); }
        else if (k === 'reset') resetPlan();
      });
    }

    if (file) file.addEventListener('change', onImportFile);

    /* ---- 当天时间轴：时段增删改 ---- */
    var dayPanel = el('dayPanel');
    if (dayPanel) {
      dayPanel.addEventListener('click', function (e) {
        var hit = e.target && e.target.closest
          ? e.target.closest('[data-slot-act], [data-slot-add]') : null;
        if (!hit) return;

        var add = hit.getAttribute('data-slot-add');
        if (add) { openSlotEditor(add, null); return; }

        var i = indexOfDate(state.sel);
        var day = i >= 0 ? days()[i] : null;
        if (!day) return;
        var templ = day.rest ? 'rest' : 'study';
        var sid = hit.getAttribute('data-sid');
        var act = hit.getAttribute('data-slot-act');
        if (act === 'up') moveSlot(templ, sid, -1);
        else if (act === 'down') moveSlot(templ, sid, 1);
        else if (act === 'edit') openSlotEditor(templ, sid);
        else if (act === 'del') deleteSlot(templ, sid);
      });
    }

    /* ---- 计划周期面板 ---- */
    var pt = el('periodToggle');
    if (pt) {
      pt.addEventListener('click', function () {
        var panel = el('periodPanel');
        if (panel && panel.hidden) openPeriod(); else closePeriod();
      });
    }

    var pp = el('periodPanel');
    if (pp) {
      function syncDates(e) {
        if (!pdDraft || !e.target) return;
        if (e.target.id === 'pdStart') pdDraft.start = e.target.value;
        else if (e.target.id === 'pdEnd') pdDraft.end = e.target.value;
        else return;
        renderPeriodStat();
      }
      pp.addEventListener('input', syncDates);
      pp.addEventListener('change', syncDates);

      pp.addEventListener('click', function (e) {
        var t2 = e.target;
        if (!t2 || !t2.closest) return;

        var q = t2.closest('[data-pd-quick]');
        if (q) { quickPeriod(q.getAttribute('data-pd-quick')); return; }

        var add = t2.closest('[data-pd-add]');
        if (add) { addPdDate(add.getAttribute('data-pd-add')); return; }

        var del = t2.closest('[data-pd-del]');
        if (del) { removePdDate(del.getAttribute('data-pd-del'), del.getAttribute('data-pd-key')); return; }

        var act = t2.closest('[data-pd-act]');
        if (act) {
          if (act.getAttribute('data-pd-act') === 'apply') applyPeriod();
          else closePeriod();
        }
      });
    }
  }

  /* ==================================================================
     Region 5 — 资源仓库
     A. CAD 图纸仓库：内置 40 张（10 图形 × 摹/临/默/检），画廊 + 筛选 + 单张/打包下载
     B. 我的资料仓库：链接（进 JSON）+ 本地文件（IndexedDB，只在本机）
     ================================================================== */

  /* 图纸目录 —— 与 assets/dxf/ 下的文件名一一对应，不依赖用户改没改计划 */
  var REPO_SHAPES = [
    { code: 'D01', name: '线条基础', part: '线条练习', what: '命令行 · 正交 · 对象捕捉 · 图层规范' },
    { code: 'D02', name: '平面几何', part: '圆角板', what: '圆 / 圆弧 / 偏移 / 修剪 / 圆角' },
    { code: 'D03', name: '对称件', part: '法兰盘', what: '极轴追踪 · 阵列 · 镜像' },
    { code: 'D04', name: '尺寸标注', part: '底板', what: 'GB/T 4458 标注样式与公差' },
    { code: 'D05', name: '文字与粗糙度', part: '轴套', what: '长仿宋 · 表面粗糙度 · 技术要求' },
    { code: 'D06', name: '主视图', part: '支座', what: '第一角投影 · 可见轮廓' },
    { code: 'D07', name: '三视图', part: '角铁座', what: '长对正 · 高平齐 · 宽相等' },
    { code: 'D08', name: '剖视图', part: '带孔底板', what: '全剖 · 剖面线方向与间距' },
    { code: 'D09', name: '图框与标题栏', part: 'A3 图幅', what: 'GB/T 14689 · GB/T 10609.1' },
    { code: 'D10', name: '综合零件图', part: '带孔底板', what: '完整出图 · 打印为 PDF' }
  ];

  var DXF_DIR = 'assets/dxf/';
  var galShape = '';
  var galMode = '';

  function galItems() {
    var out = [];
    REPO_SHAPES.forEach(function (s) {
      if (galShape && s.code !== galShape) return;
      SHEET_MODES.forEach(function (m) {
        if (galMode && m.k !== galMode) return;
        out.push({ code: s.code, shape: s, mode: m, file: s.code + '-' + m.k });
      });
    });
    return out;
  }

  function renderGalFilter() {
    var box = el('gfShape');
    if (box) {
      box.innerHTML = '';
      var all = document.createElement('button');
      all.type = 'button';
      all.className = 'gf-chip' + (galShape ? '' : ' is-on');
      all.setAttribute('data-shape', '');
      all.textContent = '全部图形';
      box.appendChild(all);
      REPO_SHAPES.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gf-chip' + (galShape === s.code ? ' is-on' : '');
        b.setAttribute('data-shape', s.code);
        b.textContent = s.code + ' ' + s.name;
        box.appendChild(b);
      });
    }

    var mb = el('gfMode');
    if (mb) {
      mb.innerHTML = '';
      var all2 = document.createElement('button');
      all2.type = 'button';
      all2.className = 'gf-chip' + (galMode ? '' : ' is-on');
      all2.setAttribute('data-mode', '');
      all2.textContent = '全部版本';
      mb.appendChild(all2);
      SHEET_MODES.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gf-chip' + (galMode === m.k ? ' is-on' : '');
        b.setAttribute('data-mode', m.k);
        b.textContent = m.cn + '（' + m.tip + '）';
        mb.appendChild(b);
      });
    }
  }

  function renderGal() {
    var box = el('gal');
    if (!box) return;

    var items = galItems();
    var cnt = el('galCount');
    if (cnt) cnt.textContent = galMode ? (items.length + ' 张') : (items.length + ' 张 / 共 40 张');

    box.innerHTML = '';
    if (!items.length) {
      var em = document.createElement('p');
      em.className = 'gal-empty';
      em.textContent = '这个组合下没有图纸，换个筛选看看。';
      box.appendChild(em);
      return;
    }

    items.forEach(function (it) {
      var card = document.createElement('div');
      card.className = 'gal-card';
      card.setAttribute('data-file', it.file);

      var img = document.createElement('img');
      img.className = 'gal-thumb';
      img.loading = 'lazy';
      img.alt = it.shape.name + ' · ' + it.mode.cn;
      img.src = DXF_DIR + it.file + '.png';
      img.setAttribute('data-preview', DXF_DIR + it.file + '.png');
      img.setAttribute('data-title', it.shape.name + ' · ' + it.mode.cn);
      img.setAttribute('data-meta', 'A3 图幅 · ' + it.mode.tip + ' · ' + it.shape.what);
      img.setAttribute('data-dl', DXF_DIR + it.file + '.dxf');
      img.setAttribute('data-dlname', it.file + '.dxf');

      var dl = document.createElement('a');
      dl.className = 'gal-dl';
      dl.href = DXF_DIR + it.file + '.dxf';
      dl.download = it.file + '.dxf';
      dl.title = '下载 ' + it.file + '.dxf';
      dl.setAttribute('aria-label', '下载 ' + it.file + '.dxf');
      dl.textContent = '↓';

      var info = document.createElement('div');
      info.className = 'gal-info';
      var nm = document.createElement('span');
      nm.className = 'gal-name';
      nm.textContent = it.shape.code + ' ' + it.shape.name;
      var md = document.createElement('span');
      md.className = 'gal-mode';
      md.textContent = it.mode.cn;
      info.appendChild(nm);
      info.appendChild(md);

      card.appendChild(img);
      card.appendChild(dl);
      card.appendChild(info);
      box.appendChild(card);
    });
  }

  /* ---------- 大图预览 ---------- */
  function openLightbox(src, title, meta, dlHref, dlName) {
    var lb = el('lightbox');
    if (!lb) return;
    var img = el('lbImg');
    if (img) { img.src = src; img.alt = title || ''; }
    var n = el('lbName');
    if (n) n.textContent = title || '';
    var m = el('lbMeta');
    if (m) m.textContent = meta || '';
    var dl = el('lbDl');
    if (dl) {
      if (dlHref) {
        dl.hidden = false;
        dl.href = dlHref;
        dl.setAttribute('download', dlName || '');
        dl.textContent = '↓ 下载';
      } else {
        dl.hidden = true;
        dl.removeAttribute('href');
        dl.removeAttribute('download');
      }
    }
    lb.hidden = false;
  }

  function closeLightbox() {
    var lb = el('lightbox');
    if (lb) lb.hidden = true;
    var img = el('lbImg');
    if (img) img.removeAttribute('src');
  }

  /* ---------- 零依赖 ZIP（只做 stored，不压缩） ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(files) {
    var enc = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    var dDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    files.forEach(function (f) {
      var nameU8 = enc.encode(f.name);
      var crc = crc32(f.data);

      var lh = new Uint8Array(30 + nameU8.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);          /* 文件名 UTF-8 */
      lv.setUint16(8, 0, true);               /* stored */
      lv.setUint16(10, dTime, true);
      lv.setUint16(12, dDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, f.data.length, true);
      lv.setUint32(22, f.data.length, true);
      lv.setUint16(26, nameU8.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameU8, 30);

      var ch = new Uint8Array(46 + nameU8.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dTime, true);
      cv.setUint16(14, dDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, f.data.length, true);
      cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, nameU8.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameU8, 46);

      parts.push(lh, f.data);
      central.push(ch);
      offset += lh.length + f.data.length;
    });

    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function zipGallery() {
    var btn = el('galZip');
    var items = galItems();
    if (!items.length) { flashRepo('没有可打包的图纸'); return; }

    var list = items.slice();
    var done = [];
    var failed = [];

    function finish() {
      if (btn) { btn.disabled = false; btn.textContent = '↓ 打包下载'; }
      if (!done.length) {
        flashRepo('打包失败：浏览器没能读取图纸文件。请通过网址访问本页（不要直接双击打开本地文件），或改用单张下载。');
        return;
      }
      var zip = makeZip(done.map(function (f) { return { name: f.name, data: f.data }; }));
      saveBlob(zip, 'CAD练习图纸-' + stampNow() + '.zip');
      flashRepo('已打包 ' + done.length + ' 张图纸' +
        (failed.length ? '（' + failed.length + ' 张读取失败，已跳过）' : ''));
    }

    function next() {
      if (!list.length) { finish(); return; }
      var it = list.shift();
      if (btn) btn.textContent = '打包中 ' + (items.length - list.length) + '/' + items.length;

      fetch(DXF_DIR + it.file + '.dxf')
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          done.push({ name: it.file + '.dxf', data: new Uint8Array(buf) });
          next();
        })
        .catch(function () {
          failed.push(it.file);
          next();
        });
    }

    if (btn) { btn.disabled = true; btn.textContent = '打包中 0/' + items.length; }
    next();
  }

  /* ---------- B1. 链接仓库（进 JSON） ---------- */
  var LINK_FIELDS = [
    { k: 'title', label: '标题', ph: '例如：线性代数的本质（3Blue1Brown）' },
    { k: 'url', label: '链接', ph: 'https://... 或直接粘贴域名' },
    { k: 'tag', label: '分类', ph: '例如：数学 / 网课 / 工具 / 待读' },
    { k: 'note', label: '备注', ph: '为什么存它、看到第几集了 —— 可留空', multi: true }
  ];

  function links() {
    if (!Array.isArray(state.links)) state.links = [];
    return state.links;
  }

  /* 只放行 http/https，挡掉 javascript: / data: 这类可被当脚本执行的协议 */
  function normUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    if (/^\s*(javascript|data|vbscript|file)\s*:/i.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
  }

  function openLinkEditor(sid) {
    var list = links();
    var i = -1;
    for (var k = 0; k < list.length; k++) { if (list[k].id === sid) { i = k; break; } }
    var isNew = i < 0;
    var base = isNew ? { title: '', url: '', tag: '', note: '' } : list[i];

    openForm(isNew ? '加一条资料链接' : '编辑这条链接', LINK_FIELDS, base, function (v) {
      if (!v.title) { modalError('标题不能为空'); return false; }
      var u = normUrl(v.url);
      if (!u) { modalError('链接要填 http:// 或 https:// 开头的网址'); return false; }
      if (isNew) {
        list.push({ id: newUid('lk'), title: v.title, url: u, tag: v.tag, note: v.note, ts: Date.now() });
        flashRepo('已加「' + v.title + '」');
      } else {
        var it = list[i];
        it.title = v.title; it.url = u; it.tag = v.tag; it.note = v.note;
        flashRepo('已保存');
      }
      save();
      renderLib();
    }, isNew ? '添加' : '保存');
  }

  function deleteLink(sid) {
    var list = links();
    var i = -1;
    for (var k = 0; k < list.length; k++) { if (list[k].id === sid) { i = k; break; } }
    if (i < 0) return;
    var title = list[i].title;
    openConfirm('删除链接', '把「' + title + '」从资料仓库里移除？', function () {
      list.splice(i, 1);
      save();
      renderLib();
      flashRepo('已移除「' + title + '」');
    });
  }

  /* ---------- B2. 本地文件仓库（IndexedDB，只在本机） ---------- */
  var IDB_NAME = 'study-site-repo';
  var IDB_STORE = 'files';
  var MAX_FILE = 30 * 1024 * 1024;      /* 单文件软上限 30MB */

  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('这个浏览器不支持本地文件仓库')); return; }
      var rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('打不开本地文件仓库')); };
    });
  }

  function idbAll() {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var rq = tx.objectStore(IDB_STORE).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }

  function idbPut(rec) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(rec);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function idbDel(id) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function fmtSize(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fileKind(type, name) {
    var t = String(type || ''), n = String(name || '');
    if (/^image\//.test(t)) return '图片';
    if (/pdf/i.test(t) || /\.pdf$/i.test(n)) return 'PDF';
    if (/word|opendocument\.text/i.test(t) || /\.(docx?|wps|odt)$/i.test(n)) return '文档';
    if (/sheet|excel|csv/i.test(t) || /\.(xlsx?|csv|tsv)$/i.test(n)) return '表格';
    if (/presentation|powerpoint/i.test(t) || /\.(pptx?|dps)$/i.test(n)) return '幻灯片';
    if (/zip|compressed|rar|7z/i.test(t) || /\.(zip|rar|7z|tar|gz)$/i.test(n)) return '压缩包';
    if (/^text\//.test(t) || /\.(txt|md|json)$/i.test(n)) return '文本';
    if (/^video\//.test(t)) return '视频';
    if (/^audio\//.test(t)) return '音频';
    return '文件';
  }

  var libBlobs = {};      /* id -> objectURL，重画时统一回收 */
  var libURLs = [];
  var libRows = [];       /* 最近一次从 IndexedDB 读到的文件记录，重画链接时复用 */

  function revokeLibURLs() {
    libURLs.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    libURLs = [];
    libBlobs = {};
  }

  function libObjectURL(id, blob) {
    if (!libBlobs[id]) {
      libBlobs[id] = URL.createObjectURL(blob);
      libURLs.push(libBlobs[id]);
    }
    return libBlobs[id];
  }

  function loadLib() {
    idbAll().then(function (rows) {
      renderLib(rows);
    }).catch(function (err) {      var box = el('lib');
      if (box) {
        box.innerHTML = '';
        var p = document.createElement('p');
        p.className = 'lib-empty';
        p.textContent = '本机文件仓库打不开（' + (err && err.message ? err.message : '未知原因') +
          '）。链接部分不受影响；如果这是浏览器隐私模式，换成普通窗口就好。';
        box.appendChild(p);
      }
    });
  }

  function renderLib(rows) {
    var box = el('lib');
    if (!box) return;

    if (rows) libRows = rows;
    else rows = libRows;

    revokeLibURLs();

    var linksList = links();
    box.innerHTML = '';

    if (!linksList.length && !(rows && rows.length)) {
      var em = document.createElement('p');
      em.className = 'lib-empty';
      em.textContent = '仓库还是空的。上面「＋ 加链接」存网课和网页，拖文件进来存图片和 PDF。' +
        '链接会跟「导出 JSON」一起备份，本机文件只留在这台设备上。';
      box.appendChild(em);
    }

    /* --- 链接卡 --- */
    linksList.forEach(function (it) {
      var card = document.createElement('div');
      card.className = 'lib-card';
      card.setAttribute('data-link', it.id);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'lib-x';
      x.setAttribute('data-act', 'del-link');
      x.setAttribute('data-id', it.id);
      x.setAttribute('aria-label', '移除 ' + it.title);
      x.textContent = '\u00d7';

      var body = document.createElement('div');
      body.className = 'lib-body';

      var kind = document.createElement('span');
      kind.className = 'lib-kind';
      kind.textContent = it.tag ? ('链接 · ' + it.tag) : '链接';
      body.appendChild(kind);

      var t = document.createElement('p');
      t.className = 'lib-title';
      t.textContent = it.title;
      body.appendChild(t);

      var s = document.createElement('p');
      s.className = 'lib-sub';
      s.textContent = it.url.replace(/^https?:\/\//, '');
      body.appendChild(s);

      if (it.note) {
        var nt = document.createElement('p');
        nt.className = 'lib-sub';
        nt.textContent = it.note;
        body.appendChild(nt);
      }

      var doRow = document.createElement('div');
      doRow.className = 'lib-do';
      var open = document.createElement('a');
      open.className = 'lib-btn';
      open.href = it.url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer nofollow';
      open.textContent = '打开';
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'lib-btn';
      edit.setAttribute('data-act', 'edit-link');
      edit.setAttribute('data-id', it.id);
      edit.textContent = '编辑';
      doRow.appendChild(open);
      doRow.appendChild(edit);
      body.appendChild(doRow);

      card.appendChild(x);
      card.appendChild(body);
      box.appendChild(card);
    });

    /* --- 文件卡 --- */
    (rows || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).forEach(function (rec) {
      var kindCn = fileKind(rec.type, rec.name);
      var card = document.createElement('div');
      card.className = 'lib-card';
      card.setAttribute('data-file-id', rec.id);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'lib-x';
      x.setAttribute('data-act', 'del-file');
      x.setAttribute('data-id', rec.id);
      x.setAttribute('aria-label', '删除 ' + rec.name);
      x.textContent = '\u00d7';

      if (kindCn === '图片' && rec.blob) {
        var img = document.createElement('img');
        img.className = 'lib-thumb';
        img.alt = rec.name;
        img.loading = 'lazy';
        img.src = libObjectURL(rec.id, rec.blob);
        img.setAttribute('data-act', 'preview-file');
        img.setAttribute('data-id', rec.id);
        card.appendChild(img);
      }

      var body = document.createElement('div');
      body.className = 'lib-body';

      var kind = document.createElement('span');
      kind.className = 'lib-kind';
      kind.textContent = kindCn + ' · ' + fmtSize(rec.size) + ' · 仅本机';
      body.appendChild(kind);

      var t = document.createElement('p');
      t.className = 'lib-title';
      t.textContent = rec.name;
      body.appendChild(t);

      var doRow = document.createElement('div');
      doRow.className = 'lib-do';
      if (kindCn === '图片') {
        var pv = document.createElement('button');
        pv.type = 'button';
        pv.className = 'lib-btn';
        pv.setAttribute('data-act', 'preview-file');
        pv.setAttribute('data-id', rec.id);
        pv.textContent = '预览';
        doRow.appendChild(pv);
      }
      var dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'lib-btn';
      dl.setAttribute('data-act', 'save-file');
      dl.setAttribute('data-id', rec.id);
      dl.textContent = '下载';
      doRow.appendChild(dl);
      body.appendChild(doRow);

      card.appendChild(x);
      card.appendChild(body);
      box.appendChild(card);
    });

    var c = el('libCount');
    if (c) {
      var kn = (rows || []).length;
      c.textContent = linksList.length + ' 条链接 · ' + kn + ' 个本机文件';
    }
  }

  var libTimer = null;
  function flashRepo(msg) {
    var h = el('libWarn');
    if (!h) return;
    h.hidden = false;
    h.textContent = msg;
    clearTimeout(libTimer);
    libTimer = setTimeout(function () { h.hidden = true; }, 5200);
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var accepted = [];
    var skipped = [];
    files.forEach(function (f) {
      if (f.size > MAX_FILE) skipped.push(f.name);
      else accepted.push(f);
    });

    if (!accepted.length) {
      flashRepo('文件太大（单个上限 30MB），换小一点的，或者先传到网盘再存链接。');
      return;
    }

    Promise.all(accepted.map(function (f) {
      return idbPut({
        id: newUid('f'),
        name: f.name,
        type: f.type || '',
        size: f.size,
        ts: Date.now(),
        blob: f
      });
    })).then(function () {
      flashRepo('已存入 ' + accepted.length + ' 个文件（只在这台设备上）' +
        (skipped.length ? '；' + skipped.length + ' 个超过 30MB 被跳过' : ''));
      loadLib();
    }).catch(function (err) {
      flashRepo('存文件失败：' + (err && err.message ? err.message : '未知原因') +
        '。浏览器存储空间可能满了，删几个大文件再试。');
    });
  }

  function handleLibClick(e) {
    var hit = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!hit) return;
    var act = hit.getAttribute('data-act');
    var id = hit.getAttribute('data-id');

    if (act === 'del-link') { deleteLink(id); return; }
    if (act === 'edit-link') { openLinkEditor(id); return; }

    if (act === 'del-file') {
      openConfirm('删除本机文件', '把这个文件从本机仓库里删掉？只影响这台设备，删了不能恢复。', function () {
        idbDel(id).then(function () { flashRepo('已删除'); loadLib(); })
          .catch(function () { flashRepo('删除失败，可能正在被预览占用'); });
      });
      return;
    }

    if (act === 'preview-file' || act === 'save-file') {
      idbAll().then(function (rows) {
        var rec = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { rec = rows[i]; break; } }
        if (!rec) { flashRepo('这个文件已经不在了'); return; }
        var url = libObjectURL(rec.id, rec.blob);
        if (act === 'save-file') {
          var a = document.createElement('a');
          a.href = url;
          a.download = rec.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          openLightbox(url, rec.name, fileKind(rec.type, rec.name) + ' · ' + fmtSize(rec.size));
        }
      }).catch(function () { flashRepo('读取失败'); });
    }
  }

  /* ---------- 事件接线 ---------- */
  function initRepo() {
    var filter = el('galFilter');
    if (filter) {
      filter.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.gf-chip') : null;
        if (!btn) return;
        if (btn.hasAttribute('data-shape')) galShape = btn.getAttribute('data-shape');
        else if (btn.hasAttribute('data-mode')) galMode = btn.getAttribute('data-mode');
        renderGalFilter();
        renderGal();
      });
    }

    var gal = el('gal');
    if (gal) {
      gal.addEventListener('click', function (e) {
        var img = e.target && e.target.closest ? e.target.closest('[data-preview]') : null;
        if (!img) return;
        openLightbox(
          img.getAttribute('data-preview'),
          img.getAttribute('data-title'),
          img.getAttribute('data-meta'),
          img.getAttribute('data-dl'),
          img.getAttribute('data-dlname')
        );
      });
    }

    var zipBtn = el('galZip');
    if (zipBtn) zipBtn.addEventListener('click', zipGallery);

    var repo = el('repo');
    if (repo) {
      repo.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-lib]') : null;
        if (!b) return;
        var k = b.getAttribute('data-lib');
        if (k === 'link') openLinkEditor(null);
        else if (k === 'pick') { var f = el('libFile'); if (f) f.click(); }
      });
    }

    var libFile = el('libFile');
    if (libFile) {
      libFile.addEventListener('change', function () {
        addFiles(libFile.files);
        libFile.value = '';
      });
    }

    var libBox = el('lib');
    if (libBox) libBox.addEventListener('click', handleLibClick);

    var drop = el('libDrop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.add('is-over');
        });
      });
      ['dragleave', 'dragend'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove('is-over');
        });
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('is-over');
        if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
      });
    }

    var lb = el('lightbox');
    if (lb) {
      lb.addEventListener('click', function (e) {
        if (e.target === lb) closeLightbox();
      });
    }
    var lbx = el('lbX');
    if (lbx) lbx.addEventListener('click', closeLightbox);

    renderGalFilter();
    renderGal();
    renderLib();
    loadLib();
  }

  /* ----------------------------------------------------------------
     Region 2 — 备份提醒
     数据只在本机浏览器里，清缓存就没了。隔太久没导出就温和提醒一次：
     不弹窗、不打断；用户点掉之后就安静 30 天，不再骚扰。
     ---------------------------------------------------------------- */
  var EXPORT_TIP_DAYS = 14;
  var MUTE_DAYS = 30;

  function daysSince(ts) {
    return ts ? (Date.now() - ts) / 86400000 : Infinity;
  }

  function renderBackupTip() {
    var tip = el('backupTip');
    if (!tip) return;

    var hasData = countCheckedSlots() > 0;
    var stale = daysSince(state.lastExport) > EXPORT_TIP_DAYS;
    var muted = daysSince(state.backupMuted) < MUTE_DAYS;

    if (!hasData || !stale || muted) { tip.hidden = true; return; }

    var txt = el('btText');
    if (txt) {
      txt.textContent = state.lastExport
        ? ('已经有 ' + Math.floor(daysSince(state.lastExport)) +
           ' 天没导出备份了。这些数据只在这台设备的浏览器里，清掉缓存就找不回来 —— 去「学习模块」点一下「导出 JSON」。')
        : ('你还没导出过备份。这些打卡和复盘只存在这台设备的浏览器里，清掉缓存就没了 —— 去「学习模块」点一下「导出 JSON」。');
    }
    tip.hidden = false;
  }

  function initBackupTip() {
    var btn = el('btClose');
    if (!btn) return;
    btn.addEventListener('click', function () {
      state.backupMuted = Date.now();
      save();
      renderBackupTip();
    });
  }

  /* ==================================================================
     Region 6 — 数据中心
     所有指标都从已有的 state 推导，不新增任何存储字段。
     ================================================================== */

  /* 当天「主线时段」的完成情况 —— 热力图色阶和统计都用它 */
  function dayProgress(dayKey) {
    var i = indexOfDate(dayKey);
    if (i < 0) return null;
    var day = days()[i];
    var sl = slotsOf(day);
    if (!sl.length) return { day: day, done: 0, total: 0, ratio: 0 };
    var core = sl.filter(function (x) { return x.kind === 'core'; });
    var list = core.length ? core : sl;
    var done = 0;
    for (var k = 0; k < list.length; k++) {
      if (isChecked(dayKey, list[k].id)) done++;
    }
    return { day: day, done: done, total: list.length, ratio: done / list.length };
  }

  /* 最长连续「完成学习日」。休息日跳过：既不计入、也不打断连续。 */
  function bestStreak() {
    var a = days(), best = 0, cur = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i].rest) continue;
      if (dayComplete(a[i].d)) {
        cur++;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
    }
    return best;
  }

  /* 周期内「已经过去的天数」—— 日均打卡时段的分母 */
  function elapsedDays() {
    var a = days();
    if (!a.length) return 0;
    var t = todayKey();
    if (t < a[0].d) return 0;
    if (t > a[a.length - 1].d) return a.length;
    return indexOfDate(t) + 1;
  }

  /* 周期内每一天的打卡时段数（一次聚合，趋势图直接用） */
  function checkCountByDate() {
    var inP = {};
    var a = days();
    for (var i = 0; i < a.length; i++) inP[a[i].d] = true;
    var m = {};
    Object.keys(state.checks).forEach(function (k) {
      if (!state.checks[k]) return;
      var d = k.slice(0, 10);
      if (!inP[d]) return;
      m[d] = (m[d] || 0) + 1;
    });
    return m;
  }

  function renderStats() {
    var best = el('sBest');
    if (best) best.innerHTML = bestStreak() + '<span class="mu">天</span>';

    var daysEl = el('sDays');
    if (daysEl) daysEl.innerHTML = countStudyDone() + '<span class="mu">天</span>';

    var slots = countCheckedSlots();
    var slotEl = el('sSlots');
    if (slotEl) slotEl.innerHTML = slots + '<span class="mu">段</span>';

    var denom = elapsedDays();
    var avgEl = el('sAvg');
    if (avgEl) {
      var v = denom ? slots / denom : 0;
      avgEl.innerHTML = v.toFixed(1) + '<span class="mu">段/天</span>';
    }

    renderHeatmap();
    renderBars();
    renderTrend();
  }

  /* ---- 年度热力图：一列一周，7 行是星期 ---------- */
  function renderHeatmap() {
    var wrap = el('heatmap');
    if (!wrap) return;

    var a = days();
    var note = el('hmNote');

    if (!a.length) {
      wrap.innerHTML = '';
      if (note) note.textContent = '还没有设置周期';
      return;
    }

    if (note) {
      note.textContent = a[0].d.replace(/-/g, '.') + ' – ' +
        a[a.length - 1].d.replace(/-/g, '.') + ' · 共 ' + a.length + ' 天';
    }

    var html = '';
    /* 首列上方补位：周期第一天是周几，就让每列对齐到真正的星期 */
    var lead = parseYmd(a[0].d).getDay();
    for (var q = 0; q < lead; q++) {
      html += '<span class="hm-cell" style="visibility:hidden"></span>';
    }

    var tKey = todayKey();
    a.forEach(function (day) {
      var pr = dayProgress(day.d);
      var lv = 0;
      if (pr && pr.ratio > 0) {
        lv = pr.ratio >= 0.999 ? 4 : (pr.ratio >= 0.67 ? 3 : (pr.ratio >= 0.34 ? 2 : 1));
      }
      var cls = 'hm-cell';
      if (lv) cls += ' l' + lv;
      else if (day.rest) cls += ' is-rest';
      if (day.d === tKey) cls += ' is-today';
      if (day.d === state.sel) cls += ' is-sel';

      var tip = day.d + ' ' + day.wd + ' · ' + (day.rest ? '休息日' : '学习日') +
        (pr && pr.total ? ' · 完成 ' + pr.done + '/' + pr.total : '');
      html += '<button type="button" class="' + cls + '" data-date="' + esc(day.d) + '"' +
        ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '"></button>';
    });
    wrap.innerHTML = html;
  }

  /* ---- 各线完成度：按模块里勾掉的阶段算 ---------- */
  function renderBars() {
    var wrap = el('trackBars');
    if (!wrap) return;

    var list = tracks();
    if (!list.length) {
      wrap.innerHTML = '<p class="bars-empty">还没有学习模块。</p>';
      return;
    }

    var html = '';
    list.forEach(function (t) {
      var total = t.steps ? t.steps.length : 0;
      var done = trackDone(t);
      var pct = total ? Math.round(done / total * 100) : 0;
      html += '<div class="bar-row">' +
        '<span class="bar-name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-pct">' + done + '/' + total + ' · ' + pct + '%</span>' +
        '</div>';
    });
    wrap.innerHTML = html;
  }

  /* ---- 打卡趋势：按周 / 按月聚合累计打卡时段数 ---------- */
  var trendGran = 'week';

  function trendBucketKey(dstr) {
    if (trendGran === 'month') return dstr.slice(0, 7);
    var d = parseYmd(dstr);
    if (!d) return dstr;
    var back = (d.getDay() + 6) % 7;                 /* 以周一为一周起点 */
    return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
  }

  function renderTrend() {
    var wrap = el('trend');
    if (!wrap) return;

    var a = days();
    if (!a.length) {
      wrap.innerHTML = '<p class="trend-empty">还没有设置周期。</p>';
      return;
    }

    var byDate = checkCountByDate();
    var map = {}, order = [];
    a.forEach(function (day) {
      var key = trendBucketKey(day.d);
      if (!map[key]) { map[key] = { key: key, n: 0 }; order.push(key); }
      map[key].n += (byDate[day.d] || 0);
    });

    var max = 1;
    order.forEach(function (k) { if (map[k].n > max) max = map[k].n; });

    var BAR = 96;                                    /* 柱子的最大像素高度 */
    /* 按周时一整年有 53 列，标签全标会糊成一片 —— 抽到约 12 个 */
    var step = trendGran === 'month' ? 1 : Math.max(1, Math.ceil(order.length / 12));

    var html = '';
    order.forEach(function (k, i) {
      var b = map[k];
      var h = b.n ? Math.max(Math.round(b.n / max * BAR), 3) : 2;

      /* 跨年首周的周一可能落在周期之前（比如 2025-12-29），
         那样标出来会被误读，改用周期第一天来标 */
      var lblKey = (trendGran === 'week' && k < a[0].d) ? a[0].d : k;
      var lbl = trendGran === 'month'
        ? (Number(k.slice(5)) + '月')
        : lblKey.slice(5).replace('-', '/');

      var show = (i % step === 0);
      html += '<div class="trend-col" title="' + esc(k + ' 起 · ' + b.n + ' 段') + '">' +
        '<span class="trend-bar' + (b.n ? '' : ' is-zero') + '" style="height:' + h + 'px"></span>' +
        '<span class="trend-k">' + (show ? esc(lbl) : '') + '</span>' +
        '</div>';
    });
    wrap.innerHTML = html;
  }

  /* ---- 选中某天（热力图点格子 / 复盘墙点条目共用） ---------- */
  function jumpToDay(d) {
    if (indexOfDate(d) < 0) return;
    state.sel = d;
    save();
    renderCal();
    renderDay();
    var panel = el('dayPanel');
    if (panel && panel.scrollIntoView) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function initStats() {
    var seg = el('trendSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-trend]') : null;
        if (!btn) return;
        var g = btn.getAttribute('data-trend');
        if (g === trendGran) return;
        trendGran = g;
        Array.prototype.forEach.call(seg.querySelectorAll('.seg-btn'), function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderTrend();
      });
    }

    var hm = el('heatmap');
    if (hm) {
      hm.addEventListener('click', function (e) {
        var cell = e.target && e.target.closest ? e.target.closest('[data-date]') : null;
        if (!cell) return;
        jumpToDay(cell.getAttribute('data-date'));
      });
    }
  }

  /* ==================================================================
     Region 7 — 复盘墙
     数据源 = 已有 state.reviews（done / stuck / next 三段）
     ================================================================== */

  var jQ = '';            /* 搜索词 */
  var jStuckOnly = false; /* 只看有卡点 */

  function journalAll() {
    var out = [];
    Object.keys(state.reviews).forEach(function (k) {
      var rv = state.reviews[k];
      if (!rv || typeof rv !== 'object') return;
      var done = String(rv.done == null ? '' : rv.done).trim();
      var stuck = String(rv.stuck == null ? '' : rv.stuck).trim();
      var next = String(rv.next == null ? '' : rv.next).trim();
      if (!done && !stuck && !next) return;
      out.push({ d: k, done: done, stuck: stuck, next: next });
    });
    out.sort(function (a, b) { return a.d < b.d ? 1 : (a.d > b.d ? -1 : 0); });
    return out;
  }

  function journalFiltered() {
    var q = jQ.trim().toLowerCase();
    return journalAll().filter(function (it) {
      if (jStuckOnly && !it.stuck) return false;
      if (!q) return true;
      return (it.d + ' ' + it.done + ' ' + it.stuck + ' ' + it.next).toLowerCase().indexOf(q) >= 0;
    });
  }

  function weekKeyOf(dstr) {
    var d = parseYmd(dstr);
    if (!d) return dstr;
    var back = (d.getDay() + 6) % 7;
    return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
  }

  function weekLabel(key) {
    var t = new Date();
    var back = (t.getDay() + 6) % 7;
    var t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back);
    var t1 = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back - 7);
    if (key === ymd(t0)) return '本周';
    if (key === ymd(t1)) return '上周';
    return Number(key.slice(5, 7)) + ' 月 ' + Number(key.slice(8)) + ' 日那周';
  }

  /* 搜索命中高亮。文本里含 & < > 时跳过（转义会改变长度，避免切错位置） */
  function jHl(text) {
    var s = esc(text);
    var q = jQ.trim();
    if (!q || /[&<>]/.test(text)) return s;
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return s.replace(re, '<mark class="jr-hit">$1</mark>');
  }

  function journalItemHtml(it) {
    var d = parseYmd(it.d);
    var wd = d ? WEEK_CN[d.getDay()] : '';
    var body = '';
    if (it.done) body += '<span class="jr-line"><span class="jr-key">做完</span>' + jHl(it.done) + '</span>';
    if (it.stuck) body += '<span class="jr-line is-stuck"><span class="jr-key">卡在</span>' + jHl(it.stuck) + '</span>';
    if (it.next) body += '<span class="jr-line"><span class="jr-key">明天</span>' + jHl(it.next) + '</span>';
    return '<button class="jr" type="button" data-jump="' + esc(it.d) + '">' +
      '<span class="jr-date">' + esc(it.d.replace(/-/g, '.')) + ' ' + esc(wd) + '</span>' +
      body +
      '</button>';
  }

  function renderJournal() {
    var wrap = el('journalList');
    if (!wrap) return;

    var all = journalAll();
    var list = journalFiltered();
    var filtering = !!jQ.trim() || jStuckOnly;

    var hint = el('jHint');
    if (hint) {
      hint.textContent = all.length
        ? ('共 ' + all.length + ' 条复盘' + (filtering ? '，筛出 ' + list.length + ' 条' : '') +
           ' · 只存在你这台设备的浏览器里')
        : '还没有复盘记录 —— 在「计划板」里点某一天，写下「做完什么 / 卡在哪 / 明天先做什么」，这里会自动汇总。';
    }

    if (!list.length) {
      wrap.innerHTML = '<p class="journal-empty">' +
        (all.length ? '没有匹配的复盘，换个关键词试试。' : '这里会按周汇总你写过的每一份复盘。') +
        '</p>';
      return;
    }

    var groups = [], byW = {};
    list.forEach(function (it) {
      var wk = weekKeyOf(it.d);
      if (!byW[wk]) { byW[wk] = { key: wk, items: [] }; groups.push(byW[wk]); }
      byW[wk].items.push(it);
    });

    var html = '';
    groups.forEach(function (g, gi) {
      var ds = g.items.map(function (x) { return x.d; }).sort();
      var range = ds[0].replace(/-/g, '.') + ' – ' + ds[ds.length - 1].replace(/-/g, '.');
      var open = gi === 0;                       /* 只有最近一周默认展开 */

      html += '<div class="jw' + (open ? ' is-open' : '') + '" data-week="' + esc(g.key) + '">' +
        '<button class="jw-head" type="button" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="jw-caret" aria-hidden="true"></span>' +
        '<span class="jw-title">' + esc(weekLabel(g.key)) + '</span>' +
        '<span class="jw-meta">' + esc(range) + ' · ' + g.items.length + ' 条</span>' +
        '</button>' +
        '<div class="jw-body">';

      g.items.forEach(function (it) { html += journalItemHtml(it); });
      html += '</div></div>';
    });
    wrap.innerHTML = html;
  }

  function flashJournal(msg) {
    var hint = el('jHint');
    if (!hint) return;
    if (!hint.getAttribute('data-orig')) hint.setAttribute('data-orig', '1');
    hint.textContent = msg;
    hint.classList.add('is-flash');
    window.setTimeout(function () { renderJournal(); }, 2000);
  }

  function exportJournalMarkdown() {
    var list = journalFiltered();
    if (!list.length) { flashJournal('没有可导出的复盘'); return; }

    var p = period();
    var out = ['# 学习复盘 · ' + p.start + ' → ' + p.end, ''];

    var groups = [], byW = {};
    list.forEach(function (it) {
      var wk = weekKeyOf(it.d);
      if (!byW[wk]) { byW[wk] = { key: wk, items: [] }; groups.push(byW[wk]); }
      byW[wk].items.push(it);
    });

    groups.forEach(function (g) {
      var ds = g.items.map(function (x) { return x.d; }).sort();
      out.push('## ' + ds[0] + ' ~ ' + ds[ds.length - 1]);
      out.push('');
      g.items.forEach(function (it) {
        var d = parseYmd(it.d);
        out.push('### ' + it.d + (d ? ' ' + WEEK_CN[d.getDay()] : ''));
        out.push('');
        if (it.done) out.push('- **完成了什么**：' + it.done);
        if (it.stuck) out.push('- **卡在哪里**：' + it.stuck);
        if (it.next) out.push('- **明天先做什么**：' + it.next);
        out.push('');
      });
    });

    var blob = new Blob([out.join('\n')], { type: 'text/markdown;charset=utf-8' });
    saveBlob(blob, 'study-journal-' + stampNow() + '.md');
    flashJournal('已导出 ' + list.length + ' 条复盘为 Markdown');
  }

  function initJournal() {
    var search = el('jSearch');
    if (search) {
      search.addEventListener('input', function () {
        jQ = search.value || '';
        renderJournal();
      });
    }

    var stuck = el('jStuck');
    if (stuck) {
      stuck.addEventListener('click', function () {
        jStuckOnly = !jStuckOnly;
        stuck.setAttribute('aria-pressed', jStuckOnly ? 'true' : 'false');
        renderJournal();
      });
    }

    var exp = el('jExport');
    if (exp) exp.addEventListener('click', exportJournalMarkdown);

    var list = el('journalList');
    if (list) {
      list.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        var head = t.closest('.jw-head');
        if (head) {
          var box = head.parentNode;
          var on = box.classList.toggle('is-open');
          head.setAttribute('aria-expanded', on ? 'true' : 'false');
          return;
        }

        var item = t.closest('[data-jump]');
        if (item) jumpToDay(item.getAttribute('data-jump'));
      });
    }
  }

  /* ----------------------------------------------------------------
     Boot
     ---------------------------------------------------------------- */
  function init() {
    load();

    /* 默认落在「今天」；今天不在周期内就落到周期第一天 */
    var a = days();
    if (indexOfDate(state.sel) < 0) {
      var t = todayIndex();
      state.sel = (t >= 0 && a[t]) ? a[t].d : (a[0] ? a[0].d : '');
    }

    initCounters();
    initDotMatrix();
    initMenu();
    initReveals();
    initReview();

    renderAll();
    initTrackTools();
    initRepo();
    initStats();
    initJournal();
    initBackupTip();

    /* 移动端 / 键盘：周期面板与预览层都能用 Esc 关掉 */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var lb = el('lightbox');
      if (lb && !lb.hidden) { closeLightbox(); return; }
      var panel = el('periodPanel');
      if (panel && !panel.hidden) closePeriod();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
