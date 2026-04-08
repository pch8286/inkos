import { useApi } from "./use-api";
import { resolveStudioLanguage, type StudioLanguage } from "../shared/language";

type Lang = StudioLanguage;

const strings = {
  // Header
  "nav.books": { zh: "书籍", en: "Books", ko: "책" },
  "nav.newBook": { zh: "新建书籍", en: "New Book", ko: "새 책" },
  "nav.config": { zh: "配置", en: "Config", ko: "설정" },
  "nav.connected": { zh: "已连接", en: "Connected", ko: "연결됨" },
  "nav.disconnected": { zh: "未连接", en: "Disconnected", ko: "미연결" },

  // Dashboard
  "dash.title": { zh: "书籍列表", en: "Books", ko: "책 목록" },
  "dash.noBooks": { zh: "还没有书", en: "No books yet", ko: "아직 책이 없습니다" },
  "dash.createFirst": { zh: "创建第一本书开始写作", en: "Create your first book to get started", ko: "첫 책을 만들어 시작하세요" },
  "dash.writeNext": { zh: "写下一章", en: "Write Next", ko: "다음 장 쓰기" },
  "dash.writing": { zh: "写作中...", en: "Writing...", ko: "작성 중..." },
  "dash.stats": { zh: "统计", en: "Stats", ko: "통계" },
  "dash.chapters": { zh: "章", en: "chapters", ko: "장" },
  "dash.recentEvents": { zh: "最近事件", en: "Recent Events", ko: "최근 이벤트" },
  "dash.writingProgress": { zh: "写作进度", en: "Writing Progress", ko: "작성 진행률" },

  // Book Detail
  "book.writeNext": { zh: "写下一章", en: "Write Next", ko: "다음 장 쓰기" },
  "book.draftOnly": { zh: "仅草稿", en: "Draft Only", ko: "초안만" },
  "book.approveAll": { zh: "全部通过", en: "Approve All", ko: "모두 승인" },
  "book.analytics": { zh: "数据分析", en: "Analytics", ko: "분석" },
  "book.noChapters": { zh: "暂无章节，点击「写下一章」开始", en: 'No chapters yet. Click "Write Next" to start.', ko: "아직 장이 없습니다. '다음 장 쓰기'를 눌러 시작하세요." },
  "book.approve": { zh: "通过", en: "Approve", ko: "승인" },
  "book.reject": { zh: "驳回", en: "Reject", ko: "반려" },
  "book.words": { zh: "字", en: "words", ko: "자" },

  // Chapter Reader
  "reader.backToList": { zh: "返回列表", en: "Back to List", ko: "목록으로" },
  "reader.approve": { zh: "通过", en: "Approve", ko: "승인" },
  "reader.reject": { zh: "驳回", en: "Reject", ko: "반려" },
  "reader.chapterList": { zh: "章节列表", en: "Chapter List", ko: "장 목록" },
  "reader.characters": { zh: "字符", en: "characters", ko: "자" },
  "reader.edit": { zh: "编辑", en: "Edit", ko: "편집" },
  "reader.preview": { zh: "预览", en: "Preview", ko: "미리보기" },

  // Book Create
  "create.title": { zh: "创建书籍", en: "Create Book", ko: "책 만들기" },
  "create.bookTitle": { zh: "书名", en: "Title", ko: "책 제목" },
  "create.language": { zh: "语言", en: "Language", ko: "언어" },
  "create.genre": { zh: "题材", en: "Genre", ko: "장르" },
  "create.wordsPerChapter": { zh: "每章字数", en: "Words / Chapter", ko: "장당 분량" },
  "create.targetChapters": { zh: "目标章数", en: "Target Chapters", ko: "목표 장 수" },
  "create.creating": { zh: "创建中...", en: "Creating...", ko: "생성 중..." },
  "create.submit": { zh: "创建书籍", en: "Create Book", ko: "책 생성" },
  "create.titleRequired": { zh: "请输入书名", en: "Title is required", ko: "책 제목을 입력하세요" },
  "create.genreRequired": { zh: "请选择题材", en: "Genre is required", ko: "장르를 선택하세요" },
  "create.placeholder": { zh: "请输入书名...", en: "Book title...", ko: "책 제목을 입력하세요..." },

  // Analytics
  "analytics.title": { zh: "数据分析", en: "Analytics", ko: "분석" },
  "analytics.totalChapters": { zh: "总章数", en: "Total Chapters", ko: "총 장 수" },
  "analytics.totalWords": { zh: "总字数", en: "Total Words", ko: "총 글자 수" },
  "analytics.avgWords": { zh: "平均字数/章", en: "Avg Words/Chapter", ko: "평균 분량/장" },
  "analytics.statusDist": { zh: "状态分布", en: "Status Distribution", ko: "상태 분포" },

  // Breadcrumb
  "bread.books": { zh: "书籍", en: "Books" },
  "bread.newBook": { zh: "新建书籍", en: "New Book" },
  "bread.config": { zh: "配置", en: "Config" },
  "bread.home": { zh: "首页", en: "Home" },
  "bread.chapter": { zh: "第{n}章", en: "Chapter {n}" },

  // Config
  "config.title": { zh: "项目配置", en: "Project Config", ko: "프로젝트 설정" },
  "config.project": { zh: "项目名", en: "Project", ko: "프로젝트명" },
  "config.language": { zh: "语言", en: "Language", ko: "언어" },
  "config.provider": { zh: "提供方", en: "Provider", ko: "제공자" },
  "config.model": { zh: "模型", en: "Model", ko: "모델" },
  "config.editHint": { zh: "通过 CLI 编辑配置：", en: "Edit via CLI:", ko: "CLI로 설정 편집:" },

  // Sidebar
  "nav.system": { zh: "系统", en: "System", ko: "시스템" },
  "nav.daemon": { zh: "守护进程", en: "Daemon", ko: "데몬" },
  "nav.logs": { zh: "日志", en: "Logs", ko: "로그" },
  "nav.running": { zh: "运行中", en: "Running", ko: "실행 중" },
  "nav.agentOnline": { zh: "代理在线", en: "Agent Online", ko: "에이전트 온라인" },
  "nav.agentOffline": { zh: "代理离线", en: "Agent Offline", ko: "에이전트 오프라인" },
  "nav.tools": { zh: "工具", en: "Tools", ko: "도구" },
  "nav.style": { zh: "文风", en: "Style", ko: "문체" },
  "nav.import": { zh: "导入", en: "Import", ko: "가져오기" },
  "nav.radar": { zh: "市场雷达", en: "Radar", ko: "시장 레이더" },
  "nav.doctor": { zh: "环境诊断", en: "Doctor", ko: "환경 진단" },

  // Book Detail extras
  "book.deleteBook": { zh: "删除书籍", en: "Delete Book" },
  "book.confirmDelete": { zh: "确认删除此书及所有章节？", en: "Delete this book and all chapters?" },
  "book.settings": { zh: "书籍设置", en: "Book Settings" },
  "book.status": { zh: "状态", en: "Status" },
  "book.drafting": { zh: "草稿中...", en: "Drafting..." },
  "book.pipelineWriting": { zh: "后台正在写作，本页会在完成后自动刷新。", en: "Background writing is running. This page will refresh automatically when it finishes." },
  "book.pipelineDrafting": { zh: "后台正在生成草稿，本页会在完成后自动刷新。", en: "Background drafting is running. This page will refresh automatically when it finishes." },
  "book.pipelineFailed": { zh: "后台任务失败", en: "Background job failed" },
  "book.save": { zh: "保存", en: "Save" },
  "book.saving": { zh: "保存中...", en: "Saving..." },
  "book.rewrite": { zh: "重写", en: "Rewrite" },
  "book.audit": { zh: "审计", en: "Audit" },
  "book.export": { zh: "导出", en: "Export" },
  "book.approvedOnly": { zh: "仅已通过", en: "Approved Only" },
  "book.manuscriptTitle": { zh: "章节标题", en: "Manuscript Title" },
  "book.curate": { zh: "操作", en: "Actions" },
  "book.spotFix": { zh: "精修", en: "Spot Fix" },
  "book.polish": { zh: "打磨", en: "Polish" },
  "book.rework": { zh: "重作", en: "Rework" },
  "book.antiDetect": { zh: "反检测", en: "Anti-Detect" },
  "book.statusActive": { zh: "进行中", en: "Active" },
  "book.statusPaused": { zh: "已暂停", en: "Paused" },
  "book.statusOutlining": { zh: "大纲中", en: "Outlining" },
  "book.statusCompleted": { zh: "已完成", en: "Completed" },
  "book.statusDropped": { zh: "已放弃", en: "Dropped" },
  "book.truthFiles": { zh: "真相文件", en: "Truth Files" },

  // Style
  "style.title": { zh: "文风分析", en: "Style Analyzer" },
  "style.sourceName": { zh: "来源名称", en: "Source Name" },
  "style.sourceExample": { zh: "如：参考小说", en: "e.g. Reference Novel" },
  "style.textSample": { zh: "文本样本", en: "Text Sample" },
  "style.pasteHint": { zh: "粘贴参考文本进行文风分析...", en: "Paste reference text for style analysis..." },
  "style.analyze": { zh: "分析", en: "Analyze" },
  "style.analyzing": { zh: "分析中...", en: "Analyzing..." },
  "style.results": { zh: "分析结果", en: "Analysis Results" },
  "style.avgSentence": { zh: "平均句长", en: "Avg Sentence Length" },
  "style.vocabDiversity": { zh: "词汇多样性", en: "Vocabulary Diversity" },
  "style.avgParagraph": { zh: "平均段落长度", en: "Avg Paragraph Length" },
  "style.sentenceStdDev": { zh: "句长标准差", en: "Sentence StdDev" },
  "style.topPatterns": { zh: "主要模式", en: "Top Patterns" },
  "style.rhetoricalFeatures": { zh: "修辞特征", en: "Rhetorical Features" },
  "style.importToBook": { zh: "导入到书籍", en: "Import to Book" },
  "style.selectBook": { zh: "选择书籍...", en: "Select book..." },
  "style.importGuide": { zh: "导入文风指南", en: "Import Style Guide" },
  "style.emptyHint": { zh: "粘贴文本并点击分析查看文风档案", en: "Paste text and click Analyze to see style profile" },

  // Import
  "import.title": { zh: "导入工具", en: "Import Tools" },
  "import.chapters": { zh: "导入章节", en: "Import Chapters" },
  "import.canon": { zh: "导入母本", en: "Import Canon" },
  "import.fanfic": { zh: "同人创作", en: "Fanfic" },
  "import.selectTarget": { zh: "选择目标书籍...", en: "Select target book..." },
  "import.splitRegex": { zh: "分割正则（可选）", en: "Split regex (optional)" },
  "import.pasteChapters": { zh: "粘贴章节文本...", en: "Paste chapter text..." },
  "import.selectSource": { zh: "选择源（母本）...", en: "Select source (parent)..." },
  "import.selectDerivative": { zh: "选择目标（衍生）...", en: "Select target (derivative)..." },
  "import.fanficTitle": { zh: "同人小说标题", en: "Fanfic title" },
  "import.pasteMaterial": { zh: "粘贴原作文本/设定/角色资料...", en: "Paste source material..." },
  "import.importing": { zh: "导入中...", en: "Importing..." },
  "import.creating": { zh: "创建中...", en: "Creating..." },

  // Radar
  "radar.title": { zh: "市场雷达", en: "Market Radar" },
  "radar.scan": { zh: "扫描市场", en: "Scan Market" },
  "radar.scanning": { zh: "扫描中...", en: "Scanning..." },
  "radar.summary": { zh: "市场概要", en: "Market Summary" },
  "radar.emptyHint": { zh: "点击「扫描市场」分析当前趋势和机会", en: "Click \"Scan Market\" to analyze trends and opportunities" },

  // Doctor
  "doctor.title": { zh: "环境诊断", en: "Environment Check" },
  "doctor.recheck": { zh: "重新检查", en: "Re-check" },
  "doctor.inkosJson": { zh: "inkos.json 配置", en: "inkos.json configuration" },
  "doctor.projectEnv": { zh: "项目 .env 文件", en: "Project .env file" },
  "doctor.globalEnv": { zh: "全局 ~/.inkos/.env", en: "Global ~/.inkos/.env" },
  "doctor.booksDir": { zh: "书籍目录", en: "Books directory" },
  "doctor.llmApi": { zh: "LLM API 连接", en: "LLM API connectivity" },
  "doctor.connected": { zh: "已连接", en: "Connected" },
  "doctor.failed": { zh: "失败", en: "Failed" },
  "doctor.allPassed": { zh: "所有检查通过 — 环境健康", en: "All checks passed — environment is healthy" },
  "doctor.someFailed": { zh: "部分检查失败 — 请查看配置", en: "Some checks failed — review configuration" },

  // Genre extras
  "genre.createNew": { zh: "创建新题材", en: "Create New Genre", ko: "새 장르 만들기" },
  "genre.editGenre": { zh: "编辑", en: "Edit", ko: "편집" },
  "genre.deleteGenre": { zh: "删除", en: "Delete", ko: "삭제" },
  "genre.confirmDelete": { zh: "确认删除此题材？", en: "Delete this genre?", ko: "이 장르를 삭제할까요?" },
  "genre.chapterTypes": { zh: "章节类型", en: "Chapter Types", ko: "장 유형" },
  "genre.fatigueWords": { zh: "疲劳词", en: "Fatigue Words", ko: "피로도 단어" },
  "genre.numericalSystem": { zh: "数值系统", en: "Numerical System", ko: "수치 시스템" },
  "genre.powerScaling": { zh: "力量等级", en: "Power Scaling", ko: "전투력 스케일" },
  "genre.eraResearch": { zh: "时代研究", en: "Era Research", ko: "시대 조사" },
  "genre.pacingRule": { zh: "节奏规则", en: "Pacing Rule", ko: "전개 규칙" },
  "genre.rules": { zh: "规则", en: "Rules", ko: "규칙" },
  "genre.saveChanges": { zh: "保存更改", en: "Save Changes", ko: "변경 저장" },
  "genre.cancel": { zh: "取消", en: "Cancel", ko: "취소" },
  "genre.copyToProject": { zh: "复制到项目", en: "Copy to Project", ko: "프로젝트에 복사" },
  "genre.selectHint": { zh: "选择题材查看详情", en: "Select a genre to view details", ko: "장르를 선택해 세부 정보를 보세요" },
  "genre.commaSeparated": { zh: "逗号分隔", en: "comma-separated", ko: "쉼표로 구분" },
  "genre.rulesMd": { zh: "规则（Markdown）", en: "Rules (Markdown)", ko: "규칙 (Markdown)" },

  // Config extras
  "config.modelRouting": { zh: "模型路由", en: "Model Routing", ko: "모델 라우팅" },
  "config.agent": { zh: "代理", en: "Agent", ko: "에이전트" },
  "config.baseUrl": { zh: "基础 URL", en: "Base URL", ko: "기본 URL" },
  "config.default": { zh: "默认", en: "default", ko: "기본값" },
  "config.optional": { zh: "可选", en: "optional", ko: "선택 사항" },
  "config.saveOverrides": { zh: "保存路由", en: "Save Overrides", ko: "라우팅 저장" },
  "config.save": { zh: "保存", en: "Save", ko: "저장" },
  "config.saving": { zh: "保存中...", en: "Saving...", ko: "저장 중..." },
  "config.cancel": { zh: "取消", en: "Cancel", ko: "취소" },
  "config.edit": { zh: "编辑", en: "Edit", ko: "편집" },
  "config.enabled": { zh: "启用", en: "Enabled", ko: "활성화" },
  "config.disabled": { zh: "禁用", en: "Disabled", ko: "비활성화" },
  "config.korean": { zh: "韩语", en: "Korean", ko: "한국어" },
  "config.globalTitle": { zh: "全局 LLM 配置", en: "Global LLM Config", ko: "전역 LLM 설정" },
  "config.globalHint": { zh: "相当于在 Studio 里运行 inkos config set-global。", en: "Equivalent to running inkos config set-global from Studio.", ko: "Studio 안에서 inkos config set-global을 하는 것과 같습니다." },
  "config.globalConfigured": { zh: "已配置", en: "Configured", ko: "설정됨" },
  "config.globalMissing": { zh: "未配置", en: "Not Configured", ko: "미설정" },
  "config.saveGlobal": { zh: "保存全局配置", en: "Save Global Config", ko: "전역 설정 저장" },
  "config.globalSaved": { zh: "全局配置已保存。", en: "Global config saved.", ko: "전역 설정을 저장했습니다." },
  "config.apiKey": { zh: "API Key", en: "API Key", ko: "API 키" },
  "config.apiKeyStored": { zh: "已保存，留空则保持不变", en: "Already stored; leave blank to keep it", ko: "이미 저장됨, 비워두면 유지됩니다" },
  "config.oauthHint": { zh: "CLI OAuth 提供方不需要 baseUrl 和 API key。先点击登录，再保存 provider/model 即可。", en: "CLI OAuth providers do not need a baseUrl or API key. Launch login first, then save provider/model.", ko: "CLI OAuth 제공자는 baseUrl과 API 키가 필요 없습니다. 먼저 로그인한 뒤 provider/model만 저장하면 됩니다." },
  "config.authenticated": { zh: "已认证", en: "Authenticated", ko: "인증됨" },
  "config.notAuthenticated": { zh: "未认证", en: "Not Authenticated", ko: "미인증" },
  "config.launchLogin": { zh: "打开登录终端", en: "Launch Login Terminal", ko: "로그인 터미널 열기" },
  "config.launchingLogin": { zh: "启动中...", en: "Launching...", ko: "실행 중..." },
  "config.refreshStatus": { zh: "刷新状态", en: "Refresh Status", ko: "상태 새로고침" },
  "config.providerLabel": { zh: "提供方", en: "Provider", ko: "제공자" },
  "config.defaultLanguage": { zh: "默认语言", en: "Default language", ko: "기본 언어" },
  "config.storedPath": { zh: "保存位置", en: "Stored in", ko: "저장 위치" },
  "config.connectBrowser": { zh: "在浏览器中连接", en: "Connect in Browser", ko: "브라우저에서 연결" },
  "config.reauthenticate": { zh: "重新认证", en: "Re-authenticate", ko: "다시 인증" },
  "config.authStatus": { zh: "认证状态", en: "Auth status", ko: "인증 상태" },
  "config.openAuthPage": { zh: "打开认证页面", en: "Open authorization page", ko: "인증 페이지 열기" },
  "config.submit": { zh: "提交", en: "Submit", ko: "제출" },
  "config.pasteGeminiCode": { zh: "粘贴 Gemini 验证码", en: "Paste Gemini auth code", ko: "Gemini 인증 코드를 붙여넣기" },
  "config.installCommandFirst": { zh: "请先安装 `{command}` 再回来认证。", en: "Install `{command}` first, then return here to authenticate.", ko: "`{command}`를 먼저 설치한 뒤 여기서 인증하세요." },
  "config.commandDetected": { zh: "`{command}` 已检测到", en: "`{command}` detected", ko: "`{command}` 감지됨" },
  "config.commandMissing": { zh: "`{command}` 없음", en: "`{command}` not found", ko: "`{command}` 없음" },
  "config.summaryReady": { zh: "已就绪", en: "Ready", ko: "준비됨" },
  "config.summaryNeedsAuth": { zh: "需要登录", en: "Login required", ko: "로그인 필요" },
  "config.summaryNeedsKey": { zh: "需要 API Key", en: "API key required", ko: "API 키 필요" },
  "config.providerSummary": { zh: "当前提供方", en: "Current provider", ko: "현재 제공자" },
  "config.modelSummary": { zh: "当前模型", en: "Current model", ko: "현재 모델" },
  "config.authSummary": { zh: "连接状态", en: "Connection status", ko: "연결 상태" },
  "config.projectWillUse": { zh: "新项目将直接使用这组默认设置。", en: "New projects will use these defaults immediately.", ko: "새 프로젝트는 이 기본 설정을 바로 사용합니다." },
  "config.activeLlmTitle": { zh: "当前项目 LLM", en: "Current Project LLM", ko: "현재 프로젝트 LLM" },
  "config.activeLlmHint": { zh: "这里控制当前项目实际使用的 provider/model。Gemini/Codex 登录会复用上方保存的 CLI 认证。", en: "This controls the provider/model the current project actually uses. Gemini/Codex reuse the saved CLI auth above.", ko: "여기서 현재 프로젝트가 실제로 사용할 provider/model을 바꿉니다. Gemini/Codex는 위에 저장된 CLI 인증을 재사용합니다." },
  "config.globalScopeHint": { zh: "上方保存的是认证与新项目默认值；当前项目切换请看下方。", en: "The panel above stores auth and defaults for new projects; switch the active LLM for this project below.", ko: "위 패널은 인증과 새 프로젝트 기본값을 저장합니다. 현재 프로젝트의 active LLM 전환은 아래에서 합니다." },
  "config.providerRequired": { zh: "请选择提供方", en: "Provider is required", ko: "제공자를 선택하세요" },
  "config.modelRequired": { zh: "请输入模型名称", en: "Model is required", ko: "모델을 입력하세요" },
  "app.llmSettings": { zh: "LLM 设置", en: "LLM Settings", ko: "LLM 설정" },
  "app.currentProjectLlm": { zh: "当前项目", en: "Current project", ko: "현재 프로젝트" },
  "app.newProjectDefault": { zh: "新项目默认值", en: "New project default", ko: "새 프로젝트 기본값" },
  "app.loginRequired": { zh: "需要登录", en: "Login required", ko: "로그인 필요" },

  // Bootstrap
  "boot.title": { zh: "先把工作台准备好", en: "Prepare Your Workspace", ko: "작업 공간부터 준비합니다" },
  "boot.subtitle": { zh: "当前目录还不是 InkOS 项目。先在这里初始化项目，再顺手完成 Gemini/Codex/OpenAI 配置。", en: "This directory is not an InkOS project yet. Initialize it here, then wire up Gemini, Codex, or API access without leaving Studio.", ko: "현재 디렉터리는 아직 InkOS 프로젝트가 아닙니다. 여기서 먼저 프로젝트를 초기화하고, 바로 Gemini/Codex/API 설정까지 끝낼 수 있습니다." },
  "boot.initTitle": { zh: "初始化项目", en: "Initialize Project", ko: "프로젝트 초기화" },
  "boot.initHint": { zh: "项目会创建在当前目录。", en: "The project will be created in the current directory.", ko: "현재 디렉터리에 프로젝트를 생성합니다." },
  "boot.globalHint": { zh: "建议先保存全局 LLM 配置，后续所有项目都可直接复用。", en: "Saving global LLM access first is recommended so future projects work immediately.", ko: "먼저 전역 LLM 설정을 저장해두면 이후 프로젝트에서도 바로 재사용할 수 있습니다." },
  "boot.initialize": { zh: "初始化项目", en: "Initialize Project", ko: "프로젝트 초기화" },
  "boot.initializing": { zh: "初始化中...", en: "Initializing...", ko: "초기화 중..." },
  "boot.createsLabel": { zh: "初始化后会生成", en: "Initialization creates", ko: "초기화 후 생성되는 항목" },
  "boot.createsConfig": { zh: "`inkos.json` 与 `.env` 模板", en: "`inkos.json` and `.env` scaffolding", ko: "`inkos.json`과 `.env` 기본 파일" },
  "boot.createsBooks": { zh: "`books/` 与 `radar/` 工作目录", en: "`books/` and `radar/` work directories", ko: "`books/`와 `radar/` 작업 디렉터리" },
  "boot.createsReuse": { zh: "复用右侧保存的全局模型默认值", en: "Reuses the global model defaults saved on the right", ko: "오른쪽에서 저장한 전역 모델 기본값 재사용" },
  "boot.pathLabel": { zh: "当前路径", en: "Current path", ko: "현재 경로" },

  // Truth Files extras
  "truth.title": { zh: "真相文件", en: "Truth Files" },
  "truth.edit": { zh: "编辑", en: "Edit" },
  "truth.chars": { zh: "字", en: "chars" },
  "truth.save": { zh: "保存", en: "Save" },
  "truth.saving": { zh: "保存中...", en: "Saving..." },
  "truth.cancel": { zh: "取消", en: "Cancel" },
  "truth.empty": { zh: "暂无文件", en: "No truth files" },
  "truth.noFiles": { zh: "暂无文件", en: "No truth files" },
  "truth.notFound": { zh: "文件未找到", en: "File not found" },
  "truth.selectFile": { zh: "选择文件查看内容", en: "Select a file to view" },
  "truth.selectHint": { zh: "选择文件查看内容", en: "Select a file to view" },

  // Dashboard
  "dash.subtitle": { zh: "管理你的文学宇宙和 AI 辅助草稿。", en: "Manage your literary universe and AI-assisted drafts." },

  // Chapter Reader extras
  "reader.openingManuscript": { zh: "打开书稿中...", en: "Opening manuscript..." },
  "reader.manuscriptPage": { zh: "书稿页", en: "Manuscript Page" },
  "reader.minRead": { zh: "分钟阅读", en: "min read" },
  "reader.endOfChapter": { zh: "本章完", en: "End of Chapter" },

  // Daemon Control
  "daemon.title": { zh: "守护进程控制", en: "Daemon Control" },
  "daemon.running": { zh: "运行中", en: "Running" },
  "daemon.stopped": { zh: "已停止", en: "Stopped" },
  "daemon.start": { zh: "启动", en: "Start" },
  "daemon.stop": { zh: "停止", en: "Stop" },
  "daemon.starting": { zh: "启动中...", en: "Starting..." },
  "daemon.stopping": { zh: "停止中...", en: "Stopping..." },
  "daemon.waitingEvents": { zh: "等待事件...", en: "Waiting for events..." },
  "daemon.startHint": { zh: "启动守护进程查看事件", en: "Start the daemon to see events" },
  "daemon.eventLog": { zh: "事件日志", en: "Event Log" },

  // Config extras (labels)
  "config.temperature": { zh: "温度", en: "Temperature" },
  "config.maxTokens": { zh: "最大令牌数", en: "Max Tokens" },
  "config.stream": { zh: "流式输出", en: "Stream" },
  "config.chinese": { zh: "中文", en: "Chinese", ko: "중국어" },
  "config.english": { zh: "英文", en: "English", ko: "영어" },

  // BookCreate extras
  "create.platform": { zh: "平台", en: "Platform", ko: "플랫폼" },

  // Common
  "common.save": { zh: "保存", en: "Save", ko: "저장" },
  "common.cancel": { zh: "取消", en: "Cancel", ko: "취소" },
  "common.delete": { zh: "删除", en: "Delete", ko: "삭제" },
  "common.edit": { zh: "编辑", en: "Edit", ko: "편집" },
  "common.error": { zh: "错误", en: "Error", ko: "오류" },
  "common.loading": { zh: "加载中...", en: "Loading...", ko: "불러오는 중..." },
  "common.refresh": { zh: "刷新", en: "Refresh", ko: "새로고침" },
  "common.enterCommand": { zh: "输入指令...", en: "Enter command...", ko: "명령 입력..." },
  "chapter.readyForReview": { zh: "待审核", en: "Ready for Review", ko: "검토 대기" },
  "chapter.approved": { zh: "已通过", en: "Approved", ko: "승인됨" },
  "chapter.drafted": { zh: "草稿", en: "Drafted", ko: "초안" },
  "chapter.needsRevision": { zh: "需修订", en: "Needs Revision", ko: "수정 필요" },
  "chapter.imported": { zh: "已导入", en: "Imported", ko: "가져옴" },
  "chapter.auditFailed": { zh: "审计失败", en: "Audit Failed", ko: "검수 실패" },
  "chapter.label": { zh: "第{n}章", en: "Chapter {n}", ko: "{n}장" },
  "common.exportSuccess": { zh: "已导出到项目目录", en: "Exported to project directory", ko: "프로젝트 폴더로 내보냈습니다" },
  "common.exportFormat": { zh: "导出格式", en: "Export format", ko: "내보내기 형식" },
  "logs.title": { zh: "日志", en: "Logs", ko: "로그" },
  "logs.empty": { zh: "暂无日志", en: "No log entries yet", ko: "아직 로그가 없습니다" },
  "logs.showingRecent": { zh: "当前展示最近日志记录。", en: "Showing recent log entries.", ko: "최근 로그를 표시합니다." },
} as const;

export type StringKey = keyof typeof strings;
export type TFunction = (key: StringKey) => string;

export function useI18n() {
  const { data } = useApi<{ language: string }>("/project");
  const lang: Lang = resolveStudioLanguage(data?.language);

  function t(key: StringKey): string {
    const entry = strings[key] as Record<Lang, string | undefined>;
    return entry[lang] ?? entry.en ?? entry.zh ?? "";
  }

  return { t, lang };
}
