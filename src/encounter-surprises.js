import { prepareSurpriseEncounter as prepareLegacyEncounter } from './legacy-encounter-surprises.js';
// New encounters are prepared once with the raid's RNG, then saved verbatim.
// Views never draw randomness and the public action contract omits these rules.
// Authored scene decks: each card has a distinct event and consequence.
// A single existing narrative draw selects a card; this never adds RNG draws.
const ORDINARY = {
  "v2-prof-audit": { prompt: "温教授正在审查一根误差棒。", labels: ["扶正误差棒", "递上放大镜"],
    success: [
      { kind: "v2-prof-audit-success-1", brief: "误差棒当庭作证", text: "误差棒承认自己只是画得比较粗。温教授重读评测记录，把口头质疑缩回了数据范围。" },
      { kind: "v2-prof-audit-success-2", brief: "教授向坐标轴道歉", text: "你发现横轴贴反了。温教授扶正图表，郑重向横轴鞠了一躬，讨论终于回到方法。" },
      { kind: "v2-prof-audit-success-3", brief: "零假设获准旁听", text: "教授给零假设搬来一把椅子。它没有发言，却让大家把对照条件说清了。" },
    ],
    failure: [
      { kind: "v2-prof-audit-failure-1", brief: "误差棒申请休假", text: "误差棒突然横躺，声称连续加班。讨论变成劳动关系研讨，你解释到嗓子发干。" },
      { kind: "v2-prof-audit-failure-2", brief: "放大镜召来小同行", text: "镜片里挤出三个更小的评审，只争论图例字号。你没能讲完实验。" },
      { kind: "v2-prof-audit-failure-3", brief: "零假设拒绝到场", text: "教授坚持等零假设本人。空椅子越摆越多，你耗了半天才退出会场。" },
    ],
  },
  "v2-peer-collab": { prompt: "周同学的笔记本正在孵一个选题。", labels: ["掀开封面", "敲敲蛋壳", "递支铅笔"],
    success: [
      { kind: "v2-peer-collab-success-1", brief: "选题破壳见面", text: "选题从笔记本里探出头，第一句话竟是「对照组呢」。你们顺势理清了能合作的部分。" },
      { kind: "v2-peer-collab-success-2", brief: "脚注牵线搭桥", text: "一条脚注从页底爬上桌，把你们相同的疑问圈在了一起。话题终于接上了。" },
      { kind: "v2-peer-collab-success-3", brief: "橡皮擦主持讨论", text: "橡皮擦把「颠覆一切」擦掉，只留下一个能验证的问题。周同学认真记下你的想法。" },
    ],
    failure: [
      { kind: "v2-peer-collab-failure-1", brief: "选题又缩回蛋里", text: "选题听到「周五汇报」立即缩回蛋壳。你们轮流劝了半天，讨论没有进展。" },
      { kind: "v2-peer-collab-failure-2", brief: "笔记本装作没电", text: "纸质笔记本坚持自己只有百分之一电量，合上封面。你没能看到关键页。" },
      { kind: "v2-peer-collab-failure-3", brief: "脚注开起分会场", text: "每条脚注都要求单独介绍。寒暄滚成了微型会议，你费力才结束。" },
    ],
  },
  "v2-engineer-credit": { prompt: "秦工程师在给演示台举行退休仪式。", labels: ["献上一根线", "翻翻致辞"],
    success: [
      { kind: "v2-engineer-credit-success-1", brief: "演示台返聘一分钟", text: "演示台听到还有观众，决定返聘一分钟。工程师趁机把项目流程讲明白了。" },
      { kind: "v2-engineer-credit-success-2", brief: "电源线领取工牌", text: "你把绕成结的线摆直，工程师给它贴上工牌，终于腾出手聊起项目。" },
      { kind: "v2-engineer-credit-success-3", brief: "蓝屏说完告别词", text: "蓝屏的告别词只有一个错误码。工程师一眼认出老问题，谈话忽然顺畅起来。" },
    ],
    failure: [
      { kind: "v2-engineer-credit-failure-1", brief: "退休仪式无限续杯", text: "每个转接头都要发表感言。你在演示台前站了很久，没轮到项目讨论。" },
      { kind: "v2-engineer-credit-failure-2", brief: "线缆拒绝交接", text: "电源线和数据线争夺前任头衔。你绕了半天线，演示仍然没有结束。" },
      { kind: "v2-engineer-credit-failure-3", brief: "蓝屏索要纪念册", text: "设备要求所有观众签名才肯关机。你被困在签名队尾，错过了交流。" },
    ],
  },
  "v2-resource-data-swap": { prompt: "数据交换台的样本正按星座排队。", labels: ["翻开星盘", "叫一个号码"],
    success: [
      { kind: "v2-resource-data-swap-success-1", brief: "样本摘下星座牌", text: "你把星座牌翻到背面，那里才是真正的采样编号。交换台终于能按记录找资料了。" },
      { kind: "v2-resource-data-swap-success-2", brief: "异常值改坐普通席", text: "异常值承认自己只是迟到。管理员重新点名，从柜底翻出了能核验的资料。" },
      { kind: "v2-resource-data-swap-success-3", brief: "分布停止装水瓶座", text: "分布图脱下星座外套，露出清楚的统计说明。你核对了这份材料的来历。" },
    ],
    failure: [
      { kind: "v2-resource-data-swap-failure-1", brief: "水逆被写进缺失值", text: "管理员把所有空白归因于水逆。你追问了半天，仍找不到采样记录。" },
      { kind: "v2-resource-data-swap-failure-2", brief: "样本集体拒绝点名", text: "样本只接受昵称，编号没人应答。你翻遍目录也没对上资料。" },
      { kind: "v2-resource-data-swap-failure-3", brief: "星盘卡在双盲座", text: "星盘要求先猜评审的生日。队伍迟迟不动，这次没有拿到资料。" },
    ],
  },
  "v2-resource-compute-demo": { prompt: "试用柜台的显卡正在练习装忙。", labels: ["碰一下鼠标", "看看风扇"],
    success: [
      { kind: "v2-resource-compute-demo-success-1", brief: "进度条忘了表演", text: "鼠标一动，进度条忘记装忙，露出了已经完成的演示记录。工作人员打开了资料柜。" },
      { kind: "v2-resource-compute-demo-success-2", brief: "风扇唱出排班表", text: "风扇用转速唱出空闲时段。工作人员听懂了，找到了可用的试用记录。" },
      { kind: "v2-resource-compute-demo-success-3", brief: "显卡交出排练稿", text: "显卡的「正在计算」只是屏保。你和工作人员翻出真正的任务日志，核对了资源信息。" },
    ],
    failure: [
      { kind: "v2-resource-compute-demo-failure-1", brief: "进度条绕场一周", text: "进度条冲过终点后又绕回起点。你等得眼睛发酸，演示始终没有结束。" },
      { kind: "v2-resource-compute-demo-failure-2", brief: "显卡要求补交观众", text: "设备称样本量只有一个观众。工作人员去凑人数，你空等了一轮。" },
      { kind: "v2-resource-compute-demo-failure-3", brief: "风扇召开股东会", text: "风扇要求所有叶片逐一表决。柜台迟迟没法开始试用说明。" },
    ],
  },
  "v2-resource-code-share": { prompt: "开源手册的目录页宣布独立。", labels: ["翻到附录", "摸摸书脊"],
    success: [
      { kind: "v2-resource-code-share-success-1", brief: "目录接受联邦制", text: "目录同意保留页码自治，正文总算重新接上。维护者找出了项目材料。" },
      { kind: "v2-resource-code-share-success-2", brief: "附录带来外交照会", text: "附录夹着一张真实的安装说明。维护者据此厘清了复现步骤。" },
      { kind: "v2-resource-code-share-success-3", brief: "书签结束流亡", text: "失踪的书签从封底回到目录，指向那一页可核验的记录。你终于找到了资料入口。" },
    ],
    failure: [
      { kind: "v2-resource-code-share-failure-1", brief: "目录封锁第一页", text: "目录拒绝承认正文的页码。你翻来翻去，一直停在使用须知。" },
      { kind: "v2-resource-code-share-failure-2", brief: "附录宣布再次附录", text: "附录要求先读它自己的附录。你追了好几层，也没找到实现说明。" },
      { kind: "v2-resource-code-share-failure-3", brief: "书脊要求版本签证", text: "手册只认某个已下架版本。维护者翻遍箱子，仍没找到配套资料。" },
    ],
  },
  "v2-tech-terminal": { prompt: "终端提示：请证明你不是审稿人。", labels: ["碰一下回车", "读读提示"],
    success: [
      { kind: "v2-tech-terminal-success-1", brief: "终端放下戒心", text: "你敲下一个普通回车。终端发现你没有要求新增基线，终于显示了真正的错误日志。" },
      { kind: "v2-tech-terminal-success-2", brief: "光标结束绝食", text: "光标承认自己只是在等一行路径。你补齐记录，排查终于有了着落。" },
      { kind: "v2-tech-terminal-success-3", brief: "机箱停止交叉质询", text: "机箱把「为什么不用另一台机箱」划出议程，开始老老实实报告状态。" },
    ],
    failure: [
      { kind: "v2-tech-terminal-failure-1", brief: "验证码也是审稿人", text: "验证码追问为什么不使用更强的验证码。你循环验证了半天，终端仍没放行。" },
      { kind: "v2-tech-terminal-failure-2", brief: "回车键递交辞呈", text: "回车键坚持先完成交接。提示一行没动，你的排查工夫白费了。" },
      { kind: "v2-tech-terminal-failure-3", brief: "光标要求匿名评议", text: "每次移动光标都要重新盲审。你只好先结束这场输入实验。" },
    ],
  },
  "v2-tech-data-corruption": { prompt: "样本索引里有一行自称幽灵。", labels: ["照照空白行", "念出行号", "翻到页尾"],
    success: [
      { kind: "v2-tech-data-corruption-success-1", brief: "幽灵补办户口", text: "幽灵其实是一个没写完的索引。你补上对应关系，样本总算重新排好队。" },
      { kind: "v2-tech-data-corruption-success-2", brief: "空白行承认怯场", text: "空白行只是不敢显示特殊字符。核对编码后，关键记录露出了原样。" },
      { kind: "v2-tech-data-corruption-success-3", brief: "页尾捡回走失行号", text: "你在页尾找到串错位置的行号，索引恢复对应，排查得以收尾。" },
    ],
    failure: [
      { kind: "v2-tech-data-corruption-failure-1", brief: "幽灵带来三位亲属", text: "每修一行又冒出三行空白。你记下异常后暂停排查，没有继续追。" },
      { kind: "v2-tech-data-corruption-failure-2", brief: "索引开始讲鬼故事", text: "日志把栈信息念得阴森，但缺了真正的调用位置。你听完也没找到原因。" },
      { kind: "v2-tech-data-corruption-failure-3", brief: "行号彼此不认亲", text: "样本与索引各自报数，谁也对不上。你费力整理后只能先收工。" },
    ],
  },
  "v2-tech-access-conflict": { prompt: "两份源码正在争一把文件夹钥匙。", labels: ["看看钥匙", "敲敲门板", "翻翻门牌"],
    success: [
      { kind: "v2-tech-access-conflict-success-1", brief: "源码决定错峰串门", text: "你理清了引用顺序，两份源码终于不用同时抢同一个文件。" },
      { kind: "v2-tech-access-conflict-success-2", brief: "钥匙认出真正门牌", text: "路径只差一个大小写。核对后文件恢复对应，争吵自然停了。" },
      { kind: "v2-tech-access-conflict-success-3", brief: "文件夹撤回独生声明", text: "文件夹承认自己有两个入口。你记清依赖关系，冲突终于有了边界。" },
    ],
    failure: [
      { kind: "v2-tech-access-conflict-failure-1", brief: "源码分别换了门锁", text: "两份源码都称自己是唯一最新版。你反复核对，冲突仍没解开。" },
      { kind: "v2-tech-access-conflict-failure-2", brief: "钥匙要求二次引用", text: "开门需要另一把钥匙，另一把又引用这把。你记下循环后停止排查。" },
      { kind: "v2-tech-access-conflict-failure-3", brief: "文件夹假装不在家", text: "文件明明存在，却在每次调用时换名字。你折腾一阵仍没找到稳定入口。" },
    ],
  },
  "v2-route-crowd": { prompt: "走廊人群围着一个会答辩的路锥。", labels: ["拍拍路锥", "抬头看牌", "挪到墙边"],
    success: [
      { kind: "v2-route-crowd-success-1", brief: "路锥通过开题", text: "路锥终于说清自己只负责指路。围观者让出通道，你顺着标识走了过去。" },
      { kind: "v2-route-crowd-success-2", brief: "队伍恢复一维结构", text: "有人把圆形排队改回一条线。你找到边上的空处，离开了拥堵位置。" },
      { kind: "v2-route-crowd-success-3", brief: "路牌不再引用路牌", text: "箭头直接指向通道口，大家停止互相问路。你走到了另一头。" },
    ],
    failure: [
      { kind: "v2-route-crowd-failure-1", brief: "路锥被要求补实验", text: "围观者要它证明没有路锥也能指路。人群越围越紧，你只好折返。" },
      { kind: "v2-route-crowd-failure-2", brief: "队尾接上队首", text: "队伍闭成一个圆，没人知道从哪里出去。你绕了一圈又回到原地。" },
      { kind: "v2-route-crowd-failure-3", brief: "路牌加入讨论", text: "路牌和路锥争论方向定义。你等不到结论，只能另走一段。" },
    ],
  },
  "v2-route-shuttle": { prompt: "接驳车正在等自己的通讯作者。", labels: ["敲敲车窗", "读读站牌"],
    success: [
      { kind: "v2-route-shuttle-success-1", brief: "司机认领通讯作者", text: "司机举起方向盘作为身份证明，车门旁的通道终于不再被人堵着。" },
      { kind: "v2-route-shuttle-success-2", brief: "站牌完成作者排序", text: "站牌把起点和终点排回正确位置，你沿标识走到了接应方向。" },
      { kind: "v2-route-shuttle-success-3", brief: "车门通过同行评议", text: "两侧车门一致同意打开，值班员指清了去接应区的路。" },
    ],
    failure: [
      { kind: "v2-route-shuttle-failure-1", brief: "通讯作者仍在出差", text: "广播连续呼叫一位不在场的作者，车旁的人越聚越多，你又绕了回来。" },
      { kind: "v2-route-shuttle-failure-2", brief: "站牌拒绝交换顺序", text: "终点坚持自己应该列第一位。你反复问路，耽误了一阵。" },
      { kind: "v2-route-shuttle-failure-3", brief: "车门进入大修状态", text: "车门表示需要再考虑一轮。你没能从这条通道过去。" },
    ],
  },
  "v2-route-badge-check": { prompt: "值班员说你的证件照看起来没毕业。", labels: ["摆正参会证", "看看镜子"],
    success: [
      { kind: "v2-route-badge-check-success-1", brief: "照片完成答辩", text: "你指了指参会证背面的登记信息，值班员核对后结束了检查。" },
      { kind: "v2-route-badge-check-success-2", brief: "证件绳证明自己", text: "会务绳上的编号对上了名册，值班员不再纠结照片的学术气质。" },
      { kind: "v2-route-badge-check-success-3", brief: "镜子退出评审组", text: "镜子不肯评价毕业状态，值班员只好按登记信息放行。" },
    ],
    failure: [
      { kind: "v2-route-badge-check-failure-1", brief: "照片拒绝回答问题", text: "值班员盯着照片等它开口。你解释了几轮，仍没能通过这个口。" },
      { kind: "v2-route-badge-check-failure-2", brief: "证件绳被要求开题", text: "检查从证件查到绳子，你只好先离开拥堵的登记台。" },
      { kind: "v2-route-badge-check-failure-3", brief: "镜子建议延期毕业", text: "值班员认真记录了镜子的意见。你在旁边白等一阵，又绕回原路。" },
    ],
  },
  "v2-npc-replication-clinic": { prompt: "沈师姐的复现笔记长出了年轮。", labels: ["数数年轮", "翻开封底", "挪近台灯"],
    success: [
      { kind: "v2-npc-replication-clinic-success-1", brief: "年轮对上实验日期", text: "你们沿着年轮找回了一次关键设置，讨论终于从玄学回到记录。" },
      { kind: "v2-npc-replication-clinic-success-2", brief: "笔记终于说人话", text: "师姐把「你懂的」补成了操作步骤，那段复现经历总算能讲清楚了。" },
      { kind: "v2-npc-replication-clinic-success-3", brief: "台灯照出旧批注", text: "一条被胶带挡住的批注露了出来，你们确认了当年的对照条件。" },
    ],
    failure: [
      { kind: "v2-npc-replication-clinic-failure-1", brief: "年轮申请历史文物", text: "笔记被装进临时保护罩。你隔着玻璃问了半天，没看清关键页。" },
      { kind: "v2-npc-replication-clinic-failure-2", brief: "批注只写下次一定", text: "每个关键步骤旁边都是「以后补」。师姐和你一起沉默了一阵。" },
      { kind: "v2-npc-replication-clinic-failure-3", brief: "台灯开始复现阴影", text: "灯光专心重现三年前的角度，笔记却始终看不清。交流被耽搁了。" },
    ],
  },
  "v2-npc-collaboration-invite": { prompt: "许同学给空椅子贴上共同一作。", labels: ["坐到旁边", "翻翻座签"],
    success: [
      { kind: "v2-npc-collaboration-invite-success-1", brief: "空椅子让出署名", text: "许同学承认那只是占座纸条。你们坐下来，谈清了彼此真正能做的事。" },
      { kind: "v2-npc-collaboration-invite-success-2", brief: "座签改写贡献表", text: "一张座签被翻成了任务清单，讨论从作者排序回到了工作本身。" },
      { kind: "v2-npc-collaboration-invite-success-3", brief: "海报送来介绍信", text: "海报背面的旧联系人记号引出共同话题，你们终于聊到了具体合作。" },
    ],
    failure: [
      { kind: "v2-npc-collaboration-invite-failure-1", brief: "空椅子要求先发言", text: "所有人都等椅子介绍自己。你等了很久，合作话题也没开头。" },
      { kind: "v2-npc-collaboration-invite-failure-2", brief: "座签抢走会议时间", text: "座签坚持讨论字体排名，大家越说越偏，你只能结束寒暄。" },
      { kind: "v2-npc-collaboration-invite-failure-3", brief: "海报宣布另开群聊", text: "讨论不断跳到新的群名，始终没说清做什么。你费力才告辞。" },
    ],
  },
  "v2-npc-review-challenge": { prompt: "林教授问海报为什么没有呼吸。", labels: ["轻敲图表", "指指图注"],
    success: [
      { kind: "v2-npc-review-challenge-success-1", brief: "海报改用证据说话", text: "你指清数据与结论的关系。教授不再追究海报的生命体征，转而讨论实验。" },
      { kind: "v2-npc-review-challenge-success-2", brief: "图注通过肺活量测试", text: "图注没吹动气球，却准确说明了测量条件。教授接受了这个比较方式。" },
      { kind: "v2-npc-review-challenge-success-3", brief: "结论缩回证据大小", text: "你把过大的结论折回图表边缘，教授终于愿意认真听完。" },
    ],
    failure: [
      { kind: "v2-npc-review-challenge-failure-1", brief: "海报被要求做心电图", text: "讨论偏到纸张健康，实验部分始终没轮到。你解释得口干。" },
      { kind: "v2-npc-review-challenge-failure-2", brief: "图注因音量不足返修", text: "教授听不见纸上的文字，你不得不反复朗读，却没能聊到方法。" },
      { kind: "v2-npc-review-challenge-failure-3", brief: "结论跑出展板边界", text: "围观者开始讨论另一项课题，你试着拉回话题，最终还是没谈下去。" },
    ],
  },
  "v2-resource-demo-sample": { prompt: "样例盒子里正在举行数据选秀。", labels: ["掀一下盒盖", "读读节目单"],
    success: [
      { kind: "v2-resource-demo-sample-success-1", brief: "样例停止争C位", text: "你按采样编号点名，样例不再挤到镜头前，工作人员找回了配套记录。" },
      { kind: "v2-resource-demo-sample-success-2", brief: "节目单露出采样表", text: "翻过夸张的节目介绍，背面竟是完整的来源说明。资料终于能核验了。" },
      { kind: "v2-resource-demo-sample-success-3", brief: "评委席改成标注台", text: "工作人员收起打分灯，按原始类别重新整理样例。你看懂了材料用途。" },
    ],
    failure: [
      { kind: "v2-resource-demo-sample-failure-1", brief: "样例集体要求重录", text: "每份样例都嫌自己表现不好，盒盖迟迟不肯合上。资料没能整理出来。" },
      { kind: "v2-resource-demo-sample-failure-2", brief: "节目单只有广告", text: "你翻到最后也没找到数据说明，工作人员同样一脸茫然。" },
      { kind: "v2-resource-demo-sample-failure-3", brief: "选秀进入加赛阶段", text: "盒子里宣布再加三轮，队伍一直不动，你白等了一阵。" },
    ],
  },
  "v2-resource-source-code": { prompt: "贡献台的分号正在办理失踪登记。", labels: ["看看登记簿", "敲敲键盘", "问问括号"],
    success: [
      { kind: "v2-resource-source-code-success-1", brief: "分号从注释区回家", text: "分号一直躲在注释里。维护者理清版本后，打开了可查阅的项目记录。" },
      { kind: "v2-resource-source-code-success-2", brief: "括号撤回寻人启事", text: "左右括号终于对上号，维护者腾出手整理了公开材料。" },
      { kind: "v2-resource-source-code-success-3", brief: "登记簿就是提交记录", text: "你发现登记时间对应提交历史，顺着记录找到了需要的资料。" },
    ],
    failure: [
      { kind: "v2-resource-source-code-failure-1", brief: "分号坚持使用艺名", text: "登记簿里有十七种别名，维护者仍查不到对应版本。你跟着白忙一阵。" },
      { kind: "v2-resource-source-code-failure-2", brief: "括号各自另起一行", text: "每次询问都多开一个括号，说明变得更难读。你只好暂停查看。" },
      { kind: "v2-resource-source-code-failure-3", brief: "登记系统丢了句号", text: "登记无法结束，队伍卡在提交页面。你这次没拿到资料。" },
    ],
  },
  "v2-resource-credit-broker": { prompt: "额度柜台把排队号码写成了论文引用。", labels: ["读读号码纸", "看看叫号灯"],
    success: [
      { kind: "v2-resource-credit-broker-success-1", brief: "叫号灯学会顺序引用", text: "灯牌不再从引用三百跳到引用二，工作人员顺利查到了这次的资源记录。" },
      { kind: "v2-resource-credit-broker-success-2", brief: "号码纸补齐出处", text: "你找到号码纸背面的柜台编号，服务员终于明白你在等哪一项。" },
      { kind: "v2-resource-credit-broker-success-3", brief: "队列停止互相引用", text: "两个窗口不再互相转交，资源说明从抽屉里被找了出来。" },
    ],
    failure: [
      { kind: "v2-resource-credit-broker-failure-1", brief: "号码纸被判引用不足", text: "柜台要求先引用三张别的号码纸。你反复排队，仍没拿到资料。" },
      { kind: "v2-resource-credit-broker-failure-2", brief: "叫号灯只叫通讯作者", text: "你听了半天广播，没有一个号码被念到，队伍始终没动。" },
      { kind: "v2-resource-credit-broker-failure-3", brief: "窗口陷入引用闭环", text: "甲窗口让你问乙，乙窗口又指向甲。你绕了一轮只好离开。" },
    ],
  },
  "v2-technical-missing-driver": { prompt: "演示设备提示驱动已转行当导师。", labels: ["看看版本号", "敲敲机壳"],
    success: [
      { kind: "v2-technical-missing-driver-success-1", brief: "驱动回来带最后一届", text: "旧驱动留下了明确的版本说明，设备总算停止胡乱认亲。" },
      { kind: "v2-technical-missing-driver-success-2", brief: "版本号找回族谱", text: "你对齐兼容记录，设备认出了正确的接口，排查顺利收尾。" },
      { kind: "v2-technical-missing-driver-success-3", brief: "设备结束跨学科误会", text: "它一直把鼠标当成传感器。你核对说明，找到那条错配的设置。" },
    ],
    failure: [
      { kind: "v2-technical-missing-driver-failure-1", brief: "驱动要求先过组会", text: "设备坚持播放两小时进度汇报，真正的错误提示反而被挡住了。" },
      { kind: "v2-technical-missing-driver-failure-2", brief: "版本号临时改了姓", text: "说明与设备显示各报一套版本，你反复核对仍无从下手。" },
      { kind: "v2-technical-missing-driver-failure-3", brief: "机壳表示不招学生", text: "设备拒绝继续反馈，排查停在第一步。你只能记下现象离开。" },
    ],
  },
  "v2-technical-data-leak": { prompt: "训练集和测试集在走廊互叫乳名。", labels: ["翻翻名册", "看看批次", "挪开隔板"],
    success: [
      { kind: "v2-technical-data-leak-success-1", brief: "两组样本重新分桌", text: "你对上来源记录，把重复条目标了出来。划分问题终于有了明确线索。" },
      { kind: "v2-technical-data-leak-success-2", brief: "乳名对上原始编号", text: "熟悉的昵称来自同一个样本，记录说明了它为什么出现两次。" },
      { kind: "v2-technical-data-leak-success-3", brief: "隔板找到值班记录", text: "隔板后贴着批次说明，你核实了混入的那部分数据，结束了排查。" },
    ],
    failure: [
      { kind: "v2-technical-data-leak-failure-1", brief: "样本坚持只是撞脸", text: "两组都拒绝提供来源，你核对了半天也无法验证。" },
      { kind: "v2-technical-data-leak-failure-2", brief: "名册认错全体亲戚", text: "编号与昵称全混在一起，重复关系越查越乱。你先停下了排查。" },
      { kind: "v2-technical-data-leak-failure-3", brief: "隔板宣布开放日", text: "样本又挤到一起，刚理出的批次被打散，你白忙了一阵。" },
    ],
  },
  "v2-technical-cache-error": { prompt: "缓存声称自己才是实验的一手资料。", labels: ["翻翻旧日志", "看看时间戳", "敲敲刷新键"],
    success: [
      { kind: "v2-technical-cache-error-success-1", brief: "缓存承认记错年份", text: "时间戳露出了旧记录，你把问题定位到过期内容，提示终于能解释了。" },
      { kind: "v2-technical-cache-error-success-2", brief: "刷新键召回当事文件", text: "新旧记录并排后，差异清清楚楚。你找到了反复报错的原因。" },
      { kind: "v2-technical-cache-error-success-3", brief: "日志结束真假美猴王", text: "原始记录补上了完整路径，缓存再也无法冒充这一轮的结果。" },
    ],
    failure: [
      { kind: "v2-technical-cache-error-failure-1", brief: "缓存拿旧截图作证", text: "你每次查看都看到同一张旧图，无法确认设备当前状态。" },
      { kind: "v2-technical-cache-error-failure-2", brief: "时间戳集体装失忆", text: "日志里所有日期都空了，排查没找到足够线索。" },
      { kind: "v2-technical-cache-error-failure-3", brief: "刷新键刷新了自己", text: "按钮换了一种颜色，内容一点没变。你试了几次只好收工。" },
    ],
  },
  "v2-route-crowd-pressure": { prompt: "海报区在排队参观另一条队伍。", labels: ["看看队尾", "抬头看牌", "挪到侧廊"],
    success: [
      { kind: "v2-route-crowd-pressure-success-1", brief: "队伍取消互相参观", text: "会务员发现两个展板指向彼此，撤掉一张指示后，侧边通道空了出来。" },
      { kind: "v2-route-crowd-pressure-success-2", brief: "队尾找到自身位置", text: "最后一位终于承认自己是队尾，人群排直，你顺着空隙离开。" },
      { kind: "v2-route-crowd-pressure-success-3", brief: "侧廊退出热门榜", text: "广播不再推荐侧廊，人群散开，你走到接应方向。" },
    ],
    failure: [
      { kind: "v2-route-crowd-pressure-failure-1", brief: "队伍开始排队合影", text: "每个人都要站回原位，侧廊彻底堵住。你只好退回去。" },
      { kind: "v2-route-crowd-pressure-failure-2", brief: "队尾被发现是队首", text: "你绕了一整圈，才发现仍在同一条队伍里面。" },
      { kind: "v2-route-crowd-pressure-failure-3", brief: "路牌发布排队综述", text: "路牌只总结拥堵原因，不指向出口。你问了半天仍需绕路。" },
    ],
  },
  "v2-route-shuttle-delay": { prompt: "接驳广播把车次念成了审稿意见。", labels: ["听听广播", "翻翻站牌"],
    success: [
      { kind: "v2-route-shuttle-delay-success-1", brief: "广播删掉客套前言", text: "播音员终于念出站点，会务员给你指出了通向接应区的路。" },
      { kind: "v2-route-shuttle-delay-success-2", brief: "站牌给出具体页码", text: "一张乱贴的通知被翻正，出口方向清楚了，你不再绕圈。" },
      { kind: "v2-route-shuttle-delay-success-3", brief: "司机完成逐条回复", text: "司机逐项核对停靠点，乘客让开车旁通道，你顺利走过。" },
    ],
    failure: [
      { kind: "v2-route-shuttle-delay-failure-1", brief: "广播追加第四轮意见", text: "每条播报后都跟着「还有一个小问题」。你等到嗓音都换了，仍没问清路线。" },
      { kind: "v2-route-shuttle-delay-failure-2", brief: "站牌只写详见正文", text: "正文又让你返回站牌，你多绕了一段路。" },
      { kind: "v2-route-shuttle-delay-failure-3", brief: "车次被建议转投", text: "广播改念另一站的安排，你跟着人群走错一段，又折返回来。" },
    ],
  },
  "v2-route-badge-inspection": { prompt: "访客名册把所有人都列为待定作者。", labels: ["指指名字", "递上参会证"],
    success: [
      { kind: "v2-route-badge-inspection-success-1", brief: "名册确认到场贡献", text: "值班员按证件核对记录，把你从待定名单里找了出来。" },
      { kind: "v2-route-badge-inspection-success-2", brief: "署名顺序恢复字母序", text: "名册只是排序乱了，核对后登记结束，通道重新放行。" },
      { kind: "v2-route-badge-inspection-success-3", brief: "参会证完成身份答辩", text: "证件背面的编号解释清楚了来意，你按工作人员指示走过检查口。" },
    ],
    failure: [
      { kind: "v2-route-badge-inspection-failure-1", brief: "名册要求补共同贡献", text: "每个名字旁都要写一句贡献说明，登记队堵住，你只好绕回去。" },
      { kind: "v2-route-badge-inspection-failure-2", brief: "名字被列进未来工作", text: "值班员在下一页又下一页寻找，你等了一阵还是没办完。" },
      { kind: "v2-route-badge-inspection-failure-3", brief: "参会证收到匿名意见", text: "检查口说不清哪里不符，反复要求重看证件，你错过了放行时段。" },
    ],
  },
};

const STORY_PROMPTS = {
  reviewer_printer: ['打印机吐出一张写着「大修」的纸。', '打印机又响了，这次它认出了你。'],
  stamp_maze: ['盖章机要你先证明这枚章是真的。', '盖章机亮起了你上次的号码。'],
  faculty_cat: ['一只戴会务绳的猫占住了评审席。', '院长猫又出现了，尾巴朝你晃了晃。'],
};
const STORY_CHOICES = {
  'printer-evidence': ['看看样本', '打印机给展台样本戴上迷你领带，称它为「第一位可复现证人」，随后夹好了复现记录。'],
  'printer-rebuttal': ['写张纸条', '你写下结论边界。打印机把「感谢」两个字裱进屏保，开始逐字阅读后面的实话。'],
  'printer-reproduce': ['核对日志', '打印机想给自己的复现结果颁奖，你先核对了日志。记录一致，它才交出压在奖状下面的复现源码。'],
  'printer-boundary': ['翻翻附页', '附页要求打印机证明自己不是烤面包机。你把问题划回验证范围，带走了一条研究方向线索。'],
  'printer-limit': ['聊聊局限', '你承认论文没有解决宇宙热寂。打印机思考片刻，收起追加实验清单，留下一条研究线索。'],
  'printer-appeal': ['敲敲机盖', '机盖里竟贴着「本机也有局限」。打印机读完沉默三秒，吐出撤回通知与自己的实现源码。'],
  'stamp-record': ['翻翻存根', '存根原本在互相证明对方存在。你给它们排好页码，窗口终于肯留下第一张有限长度的回执。'],
  'stamp-sponsor': ['问问熟人', '熟人认出公章是自己监考过的老同学，在担保栏签字。公章不再追问自己的学历。'],
  'stamp-file': ['整理存根', '你把循环证明装订成册，公章发现自己盖不到封底以外。窗口宣布结案，交来通行说明和方向线索。'],
  'stamp-window': ['看看窗口', '窗口掀开帘子，里面居然是另一个更小的窗口。小窗口不讨论哲学，直接递来一份公开样本。'],
  'stamp-honor-boundary': ['翻出回执', '机器试图把「一轮」改成「一圈」。你摊开旧回执，它只好收回笔，交来样本和通行说明。'],
  'stamp-close-boundary': ['看看新表', '新表头上印着「绝对不是第二轮」。你指出它的页码，窗口按约定把整张表吞了回去。'],
  'stamp-repay': ['看看回执', '回执被排成一列后停止互相盖章。熟人宣布这笔人情结清，留下了真正写明边界的合作意向。'],
  'stamp-repay-intel': ['问问近况', '你们发现回执的分类方法藏在第一张背面。熟人决定自己收尾，也把出口登记说明讲清了。'],
  'cat-feed': ['看看食碗', '你帮志愿者摆好猫粮。院长猫对饭碗进行了双盲闻嗅，把一张侧门路线图压在爪下。'],
  'cat-chair': ['搬把椅子', '猫坐上旁听席，先给空椅子打了合格分。它终于停止拍打署名栏，开始认真打盹。'],
  'cat-side-door': ['跟着尾巴', '侧门的刷脸系统只认识猫。院长伸头一晃，你跟着它回到靠近出口的位置。'],
  'cat-sort-samples': ['看看爪印', '猫用爪印标出了自己睡过的行。你剔除污染部分，整理出可用样本，把真实帮忙写进致谢。'],
  'cat-honor-route': ['指指门口', '猫按住协议里的引路条款，没有要求续一碗。它带你回到靠近出口的位置，随后正式下班。'],
  'cat-honor-contact': ['看看纸条', '猫把纸条从玩具老鼠下面拨出来。上面是认真写过的合作线索，署名栏没有猫的名字。'],
  'cat-acknowledge': ['看看模板', '你将「完成全部实验」改成「维持局部温暖」。猫认可这份准确致谢，拨来一份合作线索。'],
  'cat-honest': ['挠挠椅背', '你解释猫没有做实验。它把虚假的贡献声明团成纸球，追了两步，又若无其事地回去旁听。'],
};
const STORY_FAILURES = {
  reviewer_printer: ['打印机卡纸了。你留下纸条，折腾了一阵才脱身。', '打印机又卡纸了，这次没有拿到资料。'],
  stamp_maze: ['窗口突然关了。你留着号码纸，在走廊白等了一阵。', '窗口提前关了，这次没有办成。'],
  faculty_cat: ['猫钻进了桌底。你追了半圈，只找到一串爪印。', '猫叼着材料跑远了，你没能追上。'],
};
const SUCCESS_TEXT = {
  npc: ['话题意外地聊开了。', '对方想起了一个有用的细节。', '你们正好说到了同一件事。'],
  resource: ['资料里夹着一张有用的便签。', '工作人员翻出了留在这里的资料。', '这份记录正好能用上。'],
  technical: ['几行记录对上了，问题解开了。', '设备重新亮了起来。', '你找到了漏掉的那一步。'],
  route: ['拐角后面恰好空着。', '值班员认出了去接应区的路。', '门开了，你顺着通道走了过去。'],
};
const FAILURE_TEXT = {
  npc: ['话题越扯越远，你费了些心力才结束。', '对方没听清，来回解释耽搁了一阵。', '人群围了过来，这场对话没能谈下去。'],
  resource: ['资料已经发完，你白等了一阵。', '翻出的记录缺了关键几页。', '工作人员临时离开，这趟没拿到东西。'],
  technical: ['提示又跳了出来，排查没有进展。', '设备重启了，刚才的工夫白费了。', '记录对不上，只能先结束排查。'],
  route: ['转角仍在排队，你只好又绕回来。', '门后堆满箱子，你原路折返。', '值班员也不清楚，你多走了一段路。'],
};
const pick = (values, random) => values[Math.floor(random() * values.length)];
const narrative = (cards, fallback, random) => cards ? { ...pick(cards, random) } : { text: pick(fallback, random) };
const successEffect = choice => choice.onSuccess || choice.success || {};

function storyChoice(event, choice) {
  const [label, text] = STORY_CHOICES[choice.key] || [choice.name, successEffect(choice).text];
  const success = { ...successEffect(choice), text };
  if (choice.key === 'cat-feed') success.story = { branch: 'shared_meal' };
  if (choice.key === 'talent-negotiate') {
    success.text = event.story.chapter === 1
      ? event.story.id === 'faculty_cat' ? '猫按下爪印，同意只旁听、不署名。' : '窗口写下约定：这次只补一轮材料。'
      : success.text;
  }
  const chapterIndex = event.story.chapter - 1;
  const failure = { text: STORY_FAILURES[event.story.id][chapterIndex],
    story: chapterIndex === 0 ? { branch: 'interrupted' } : { outcome: 'setback' } };
  return { label: choice.key === 'talent-negotiate' ? '聊聊约定' : label, success, failure };
}

/** Called only while creating a fresh encounter, never from a read-only view. */
export function prepareSurpriseEncounter(run, source, random) {
  // Saved v3 expeditions retain their complete historic action/view transcript.
  if (run.probabilityVersion === 3) return prepareLegacyEncounter(run, source, random);
  if (run.encounterVersion !== 2 || !source || source.encounterVersion === 2) return source;
  const event = structuredClone(source);
  const ordinary = ORDINARY[event.id];
  event.encounterVersion = 2;
  event.prompt = event.story ? STORY_PROMPTS[event.story.id][event.story.chapter - 1]
    : ordinary?.prompt || '眼前有了一点动静。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('纸条')) event.prompt = '打印机旁还夹着你上次留下的纸条。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('未盖章')) event.prompt = '窗口重新亮灯，你的号码还在屏幕上。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('桌底')) event.prompt = '那串爪印又出现了，桌布轻轻动了一下。';
  event.text = event.prompt;
  // All ordinary responses are available without a fee. The exit stays separate;
  // the previous always-safe decline no longer dominates the story's choices.
  let responses = event.choices.filter(choice => choice.key !== 'story-decline');
  if (responses.length > 4) responses = [...responses.slice(0, 2), ...responses.slice(-2)];
  event.choices = responses.map((choice, index) => {
    const originalSuccess = successEffect(choice);
    const isEcho = choice.key === 'story-echo';
    const story = event.story ? storyChoice(event, choice) : null;
    // A purchased identity ability keeps its explicit fee and once-only safe
    // resolution. It is distinct from the ordinary, fee-free responses.
    if (choice.talentUse) return { key: choice.key, name: '联络（人脉1）', label: '联络（人脉1）',
      requiresTalent: choice.requiresTalent, talentUse: true, cost: { network: 1 },
      onSuccess: { ...(story?.success || originalSuccess), brief: '这次的合作边界说清了' } };
    const label = story?.label || (isEcho ? '提起那件旧事' : ordinary?.labels?.[index]) || ['看看记录', '问问情况', '走近看看'][index % 3];
    // Favorability is shuffled independently of wording and position, so no
    // option is a stable "safe" answer. Skills still make a bounded difference.
    const check = { base: 50 + Math.floor(random() * 22), skill: choice.check?.skill || ({
      npc: 'expression', resource: 'research', technical: 'engineering', route: 'expression',
    })[event.type], perLevel: 1.5, cap: 10, riskFactor: 0.03,
      ...(choice.check?.gear ? { gear: choice.check.gear } : {}),
      ...(choice.check?.communication ? { communication: Math.min(5, choice.check.communication) } : {}) };
    const relief = 2 + Math.floor(random() * 5);
    const pressure = 4 + Math.floor(random() * 5);
    const strain = 1 + Math.floor(random() * 2);
    const success = story?.success || {
      ...narrative(ordinary?.success, SUCCESS_TEXT[event.type] || SUCCESS_TEXT.npc, random),
      ...(originalSuccess.rewardId ? { rewardId: originalSuccess.rewardId } : {}),
      ...(originalSuccess.support ? { support: 8 } : {}),
      ...(originalSuccess.routeDepth != null ? { routeDepth: originalSuccess.routeDepth } : {}),
      ...(originalSuccess.networkDelta ? { networkDelta: Math.max(0, Math.min(1, originalSuccess.networkDelta)) } : {}),
      ...(originalSuccess.trustDelta ? { trustDelta: Math.max(0, Math.min(1, originalSuccess.trustDelta)) } : {}),
    };
    // Echoes carry the remembered relationship, not another chapter reward.
    if (isEcho) {
      success.text = originalSuccess.text.replace(/^你花时间/, '你');
      delete success.rewardId;
    }
    success.riskDelta = -relief;
    // A good ordinary conversation can make one usable contact. This is earned
    // on resolution, never a permanent penalty or a hidden fee on failure.
    if (event.type === 'npc' && !isEcho && random() < 0.35) success.networkDelta = 1;
    if (story) {
      success.kind = `story-${event.story.id}-${choice.key}-success`;
      success.brief = success.text.split(/[，。]/)[0];
    }
    if (random() < 0.25) success.willDelta = 1;
    const failure = { ...(story?.failure || narrative(ordinary?.failure, FAILURE_TEXT[event.type] || FAILURE_TEXT.npc, random)),
      riskDelta: pressure, willDelta: -strain };
    return { key: choice.key, name: label, label, cost: {}, check,
      ...(choice.requiresTalent ? { requiresTalent: choice.requiresTalent, talentUse: choice.talentUse } : {}),
      ...(choice.xp === false ? { xp: false } : {}), onSuccess: success, onFailure: failure };
  });
  // Fisher–Yates at encounter creation, persisted with the active event.
  for (let index = event.choices.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [event.choices[index], event.choices[other]] = [event.choices[other], event.choices[index]];
  }
  return event;
}
