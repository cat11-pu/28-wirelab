# wirelab

报文装配台（原生 ES 模块，零依赖）：域名报文里同一个后缀出现第二次就换成两字节指针，回头指到它第一次出现的位置；
读的人顺着指针把名字拼回来。指得对不对、省了多少字节、失败动不动状态，都记在账上。

## 起服务看页面

    python3 -m http.server 8000

浏览器打开 http://127.0.0.1:8000/ 即可操作：最上面是后缀账（每个后缀一行，写首次偏移、被几条名字复用、省下几字节），
中间是名字账（点一行展开它解码时走过的偏移跳板），下面是报文带（等宽字节格，亮出被点中的那段名字）；
页眉那行字里带计数与四条不变量，底部一条工具条能续写事件。

## 要补的文件

    wire.js   suffixKey / encodeName / decodeName / encodeMessage / decodeMessage
    ops.js    record / build / parse / clear

audit.js、app.js、check_sample.js、tests/run.js 与页面都已写好，只调不写。

## state 上的账（形状照这个来）

    plan        记录表，每条是 [段, 标签数组, 类型, 存活秒数, 数据]
    bytes       报文字节（0 到 255 的整数数组），最后一次编码的结果
    suffix      后缀表，每条是 [后缀键, 首次出现的偏移]，按偏移升序
    forms       编码形态，每个名字一条 [后缀键, 字面标签数, 指针偏移或 -1, 写出字节数, 落点偏移]
    records     解码记录，每条是 [段, 标签数组, 类型, 存活秒数, 数据]
    paths       读取路径，每个名字一条 [后缀键, 读过的偏移序列]
    occurrences 名字出现次数（最后一次编码写了几个名字）
    follows     指针跳转总次数（最后一次解析）
    checked     往返判据：解码记录按 an ns ar 重排后与计划逐条相同给 1，否则 0
    literal     全字面字节数（这份计划不压缩要多少字节）
    saved       节省字节（全字面减去实际字节）
    compressed  用了指针的名字条数
    adds / builds / parses / clears / fails  五个计数
    ledger      失败账，按顺序记失败码

四条不变量由 audit.js 算：后缀表自洽、字节自洽、流水自洽、解析一致；页面与 check_sample.js 直接读它们。
名字在报文里的出现顺序是 段 an、ns、ar 内按登记顺序，CNAME 的点名紧跟它那条记录之后。

## 测试

    node tests/run.js

## 场景自检

    node check_sample.js
