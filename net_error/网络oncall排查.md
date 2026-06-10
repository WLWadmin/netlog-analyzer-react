# 网络oncall排查

## CCM RD 环节

网络oncall sop：[CCM 网络问题 Oncall SOP](https://bytedance.larkoffice.com/wiki/wikcnB1HpSw5cjG9R2psVv4Iunc) 

参考：[CCM 网络问题研发排查手册](https://bytedance.feishu.cn/wiki/MWEOwHlL0in0wYkOusBcsV5anKf) 

外部用户网络自查文档：[文档网络问题自查指南](https://bytedance.sg.larkoffice.com/docx/ErHXd6ySAoI8R7xwIBBlNmEPg9f)

### Oncall 信息收集

> 用户无法复现，或者已有的信息不能判断具体的原因，需要用户侧收集一些信息
> 
> 

#### **用户侧需要收集的信息内容**

- 使用Chrome浏览器访问网址：[https://ip\.skk\.moe/](https://ip.skk.moe/) 截图提供一下检测结果（如果用户的ip是轮循的，每次的结果可能不一致）

- 飞书医生检测：[飞书医生（诊断套件）使用说明（用户版）](https://bytedance.larkoffice.com/docx/VuZ8dyM31oHgiZxHNtpc2By4nQd)

    - [Wireshark 网络抓包](https://bytedance.larkoffice.com/docx/FOkgd68wLoJphWxUusecTEDTnFc?302from=wiki) （如需）

    - [GloryDeVtool的网络抓包使用](https://bytedance.larkoffice.com/wiki/wikcnB8z3qhpJ1BxnPlEgUNHadW) （如需）

- 抓取 net\-log日志。操作文档：[Chrome 网络日志收集](https://bytedance.feishu.cn/docx/NfwtdMpCLoh04yx0xnec1PXCnnf)

- 在终端执行一下nslookup、ping、dig、tracert \+\[文档域名\]（windows和mac的命令是有区别的） [【外部】网络问题信息收集](https://bytedance.larkoffice.com/docx/FOmKdpdCfoIl4WxV8eqc37BOnO1)

- 导出network的 \.har 文件[如何导出/查看 网络Network的\.har文件](https://bytedance.larkoffice.com/wiki/NbIuwtlAKi0C1nk2SkdcLcjTnDb) 

性能日志（网络可以不用）：[【用户操作】获取Performance Profile](https://bytedance.larkoffice.com/docx/PS5vdpz5joiDQixZjQdcev7Pnrn)

#### **内部应该查看的信息：**

Slardar 日志 [网络 oncall 中如何使用 slardar 进行排查](https://bytedance.larkoffice.com/wiki/N1hJwHUPFiVW2tkkdBCcfrvhncg) 

[Tea](https://data.bytedance.net/tea/app/40/behavior-detail/bd38b56beb9231f148baa938ccfd20055b2e4ec9?activeEventId=0_1&app_name=docs&curDevice=%E5%85%B6%E4%BB%96&eventCategory=all&eventOp=in&eventParamsType=json&highlightParams=action&highlightParams=source&highlightParams=session_id&highlightParams=data&identityType=user_unique_id&isShowAllCustomProps=false&isShowFiltered=true&query_type=user_unique_id&search=&selectedShowEventList=client_performance_stage&selectedShowEventList=client_performance_stage_extra&subAppEnName=docs&timestamp=1712470840316&timestamp=1712557240316)[ 日志](https://data.bytedance.net/tea/app/40/behavior-detail/bd38b56beb9231f148baa938ccfd20055b2e4ec9?activeEventId=0_1&app_name=docs&curDevice=%E5%85%B6%E4%BB%96&eventCategory=all&eventOp=in&eventParamsType=json&highlightParams=action&highlightParams=source&highlightParams=session_id&highlightParams=data&identityType=user_unique_id&isShowAllCustomProps=false&isShowFiltered=true&query_type=user_unique_id&search=&selectedShowEventList=client_performance_stage&selectedShowEventList=client_performance_stage_extra&subAppEnName=docs&timestamp=1712470840316&timestamp=1712557240316)

Logifier 端内日志 [Logifier BOT 使用指南](https://bytedance.larkoffice.com/wiki/wikcnlFY1ZlXymX5BlNiki9Qvbh) 

#### **具体操作文档及相关步骤说明**

1. 收集用户信息[【外部】网络问题信息收集](https://bytedance.feishu.cn/docx/FOmKdpdCfoIl4WxV8eqc37BOnO1?scene=multi_page&sub_scene=message) ，查询日志和slardar，看能否收集到 ip等信息

    1. 查询ip的方法：

        1. https://ip\.skk\.moe/** **

        2. ipip\.net 

        3. ip138\.com

    2. 关于DNS选择：[跨运营商问题排查指引](https://bytedance.feishu.cn/wiki/wikcnCCLyaaWYDyvLiPNEkSzM7d) （非外部文档，不能直接发给客户）

        首选推荐使用出口运营商分配的localdns

        其次是国内云厂商的公共DNS

        - 国内公共dns：
        国内运营商公共DNS：[114\.114\.114\.114](http://114.114.114.114)
        阿里云：[223\.5\.5\.5](http://223.5.5.5)  [223\.6\.6\.6](http://223.6.6.6) 
        腾讯云：[119\.29\.29\.29](http://119.29.29.29) 
        百度云：[180\.76\.76\.76](http://180.76.76.76)
        （云厂商的公共DNS一般都是BGP接入，支持多种运营商环境）

        - 海外目前无测试环境，没有针对海外推荐的DNS解析。东南亚推荐的常用dns：[Common Free DNS for APAC](https://bytedance.sg.feishu.cn/sheets/shtlge0gUmbm6u0k5DUocDLdZzg) 

2. 用户允许远程的情况下，抓 chrome net log  [Chrome 网络日志收集](https://bytedance.feishu.cn/docx/TPINdt8ocomTMPxHWPScyqEinjd) 获取 ip 等信息\(如果用户有log包了，可以通过https://netlog\-viewer\.appspot\.com/\#import直接解析\)

3. 复现的情况下使用网络中台提供的工具，进行网络检测 \& 抓包

4. 如果是网络问题且我们无法解决，把上述得到的信息归纳转单到网络 oncall 

5. KDM 反馈的问题，需要记录下来[网络 Oncall 问题分析](https://bytedance.larkoffice.com/wiki/Qg4rw2s4ziLIL0kGnaYczgb6n8e) 

    1. [Lark KDM 清单（WIP）\- platform 维护版本](https://bytedance.larkoffice.com/wiki/WdQ9wIEGUiWO48klxekcLaRBnuH)



### 如何转单给其他业务线

上下文描述不清楚，信息收集不全，会对转单造成一定的理解成本，主要的sop是：

1. 用户反馈的问题现象

2. 我们当前排查的结论

3. 遇到的问题（无法进一步排查的原因）

4. 需要他们给到的支持

以【爱奇艺反馈云文档打开慢】的oncall为case

文档demo：[排查文档\-2023\-09\-13 \| 爱奇艺 \| 云文档打开缓慢 ](https://bytedance.feishu.cn/docs/doccndSPZGjSGx4Io9KpkatRyqf) 

如何更好的整理有用信息转单妙计链接：https://bytedance\.sg\.feishu\.cn/minutes/obsgmpf27z5d1q34a7351n7z

### 请求链路

正常情况，访问一个域名，整个链路都是同个运营商，同个国家，如果出现跨运营商，或者跨境访问，会非常影响访问的质量，导致跨境跨网访问的可能是代理、安全软件的劫持、自建的dns解析问题等

比如说请求一个 [bytedance\.larkoffice\.com](http://bytedance.larkoffice.com) 的接口，服务器的机房在国内：

- 国内访问

    - 国内网络出口 A \-\> 国内 cdn 边缘节点 B \-\> 回源国内源站 C

    - 就是国内的 ABC 几个 ip 互相建联、通信

- 海外访问

    - 正常链路：

        - 网络出口海外 ip A \-\> 访问海外 cdn 厂商就近的节点 B \-\> 走专线回源国内机房 C

        - 海外 AB 节点互相建联，BC 走的是字节的内网专线

    - 有问题的代理链路：

        - 海外 ip A \-\> 国内代理出口 ip A' \-\> 海外 cdn 节点 B \-\> 专线回源 C

        - 主要的慢出现在 海外 A \-\> 国内 A'，国内 A'\-\> 海外 B，这里绕了一圈，而且这种**不走专线的跨境请求会被国家防火墙影响**，质量较差

### http://ip\.skk\.moe检测结果怎么看

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NDk2NmVhMThhZTc1ZDI5N2M0MWU4ZjBlMjczNGExNWVfN2JkMTNlZjNiOWJjYTRjZTQ5NDgxODNjNzdhMDYxMGJfSUQ6NzMyNDE2OTQ0ODMwMTgwNTU3MF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

【Ip 地址查询】即指的ip出口

- 用户多出口指的是用户是否不止有一个运营商，如果是多出口，可能就有跨运营商的问题

- 如果看用户有海外的出口，需要咨询用户是否有配置海外出口，如果有，可能会有跨境访问的问题，如果没有，就是dns解析问题

- 如果用户的ip的轮循机制的，可能要用户复现的时候才能检测出问题，正常情况是都可以检测，如果ip 地址查询有出现【更多】两个字，需点击查看，有时候有问题的ip解析会被埋在里面

### 常见的客户端\(logifier\)错误码和查询语句

客户端日志抓取：依赖 logifier 机器人 [Logifier BOT 使用指南](https://bytedance.larkoffice.com/wiki/wikcnlFY1ZlXymX5BlNiki9Qvbh)

客户端日志并不能直接证明web端的请求情况，但是可以依赖客户端日志查到用户当时的网络状况，出口 ip 信息，是否有代理或者跨网跨境等其他信息，推算出可能出现的问题

2024\-2\-16日@张思祺做了一个网络 oncall 排查经验分享

妙计地址：https://bytedance\.larkoffice\.com/minutes/obcnr7f9m7n37pro3s1m2586

文档地址：[网络问题排查经验](https://bytedance.larkoffice.com/docx/HDkidC51To1u3Ax46MDc1rKjn7b)

#### **常用查询语句**

> 查询语句都来自日志里面的内容，语句之间都可以用\&（并）和｜（或）来对条件进行过滤
> 
> 

dynamic net status（用户网络状态：是否有offline或者instantly weak）；

fetch by ttnet new wrapper end\[error\]**    **\(ttnet 连接状态：查看code错误码\)；

connect rtt （ 数据流往返的网络耗时中请求的握手时长）

on rtt update （整体网络情况，Rtt 正常在100ms以内，200就认为网络稍弱，频繁出现rtt值 \> 400ms，说明当时弱网）

request completed \& \[问题域名\]：查找请求远端ip；找到请求请求耗时和netlog id  或者 request id 查看请求

x\-tt\-cip/x\-response\-cinfo（静态资源）：查看用户本机ip

dns config： 对应的模版是**"PC webview网络 dns server配置"**，判断 dns server 配置

dns completed \& \[dns\]：对应的模版是**"PC webview网络 dns类型"，**判断 dns 解析类型是local dns还是http dns

Set ttnet websocket status: \(查看用户长链接：是succeed还是close\)

其余查询能力可参考：

- webview的排查文档 [请求慢问题排查文档\(内部\)](https://bytedance.larkoffice.com/wiki/HBmSwxdKHiYPDhkvp7BcHs1cnwh)  [网络oncall排查文档](https://bytedance.feishu.cn/wiki/DaKhw9pNYiwUtRkoqtRcaNnwngb)

- ttnet的排查文档 [【内部】网络问题排查](https://bytedance.feishu.cn/wiki/wikcnBhvFN1xQkaBk91JDXcIxVd)

- [飞书webview netlog自助分析指引](https://bytedance.larkoffice.com/docx/H5t9dVoaHomOWOxUkczcNhFXnjb) 

#### **常见错误码**

Ttnet 错误码大全：https://source\.chromium\.org/chromium/chromium/src/\+/main:net/base/net\_error\_list\.h;l=1?q=net\_error\.h\&ss=chromium

\(\-200\) \- \(\-299\)  证书问题

|状态码|解释|
|---|---|
|\-2 |属于比较通用的错误，需要具体细节排查|
|\-21|用户有发生切网|
|\-100|ERR\_CONNECTION CLOSED 链接被关闭，socket收到了FIN报文，一般发生在数据传输阶段，大部份是代理或者安全软件导致的；|
|\-101|CONNECTION\_RESET   连接重置，socket 收到了RST标记位，大部份发生在SSL阶段，通常已经完成了三次握手<br>可能为安全软件或者防火墙问题|
|\-102|拒绝连接，出现在TCP握手阶段，TCP三次握手收到了RST报文，一般是ip出现错误，可能是没有加白或放行导致的，少部分是因为非常用端口（443，80）没有放行<br>在logifier 里可以查看request id 的 connect 阶段出现的错误|
|\-103|和\-101 <br>样可能是防火墙问题，也有可能是 GFW 阻断的问题，如果是个别用户，应该是安全软件导致的|
|\-105 |dns解析失败、ttnet错误码（无法解析主机名）|
|\-107|SSL\_RPOTOCOL\_ERROR 如果该错误大量出现，则是防火墙问题|
|\-118|CONNECTION\_TIME\_OUT TCP 连接超时，建连失败，怀疑防火墙拦截或者ip跨网或者跨境|
|\-130 |代理连接失败|
|\-200|CERT\_COMMON\_NAME\_INVALID:<br>1\.排查ssl块的server\_cert\_common\_name 如果关键字包含wifi之类的，是没登陆wifi，如果是\*\.bytedance\.net证书大概率也是没登陆工区wife导致的。<br>2\.防火墙等安全软件配置出错<br>请求的域名证书和收到的证书不一样，一般发生在SSL握手，在logifier 中可以在request id里查询 ssl\_connect\_job语句过滤出来|
|\-202|证书问题，CERT\_AUTHORITY\_INVALID 证书颁发机构无效，防火墙想要中间人，需要客户IT配合查清楚拦截软件或防火墙，并单独对飞书流量进行加白，避免劫持飞书证书<br>飞书医生的域名检测功能也可以检测出来|
|\-352|一般是 http2连接黑洞,应该是切后台休眠造成的|
|\-356|QUIC\_PROTOCOL\_ERROR quic协议错误，弱网或者防火墙拦截<br>大多数是网络波动造成quic请求异常；少数是用户内网有开启udpflood，对quic支持不友好。<br>[飞书\-TTNet QUIC线上错误码典型场景](https://bytedance.larkoffice.com/docx/GQmAdgGwfoZpfZxO3LFcy6TBnUd) |



错误码分类：

1. **（\-1\) \- \(\-99\)：** 这类错误一般属于飞书端内或者电脑端内或者业务逻辑导致的一类错误。 比如\(\-7\)表示请求超时（具体是哪里超时需要具体分析。）或者\(\-3\)表示请求被取消。

2. **\(\-100\) \- \(\-199\)：**这个段位一般表示网络链路问题，包括ssl和dns解析问题。 比如最常见的\(\-101\)和\(\-102\)问题，都属于此范围

3. **\(\-200\) \- \(\-299\) :** 表示请求证书出错。 最常见的（至今也是最头疼的）\-202问题就属于此类。

4. **\(\-300\) \- \(\-399\)：**属于应用层协议类问题，比较少遇到。比如http/http2协议，或者quic协议等。

5. **\(\-400\) \- \(\-799\)：**作者表示也不怎么了解这三个段位的错误。因为几乎没遇到和研究过。

6. **\(\-800\) \- \(\-899\)**：dns协议类错误（注意与\-105这种不同的是，\-8xx更描述的是dns请求失败这种问题），也很少出现。

#### 客户端上报的header 信息含义

- X\-Tt\-Logid:logid,服务端查询argos日志

- X\-Tt\-Trace\-Host:链路tracehost,查询CDN网络链路节点跳转

- X\-Response\-Cinfo:客户端出口ip

- X\-Response\-Sinfo:服务端 ip

- Server\-Timing:CDN耗时

#### case：用户反馈端内文档打不开

logifier链接：[🔗链接](https://logifier.bytedance.net/lg/batch/793949/search?dsl=request+completed+%26+was+cached+false+%26+js+%26+total+time+cost%3A++%7C+request_id%3A+25570%2C+uid_tag%3A+0+&startDt=1704271582798&endDt=1735522089677&showStartTime=1703667573685&showEndTime=1735522089677&levels=IDWEF&tz=Asia%2FShanghai&fileFields=context%2Cthread%2Cfileline%2Clevel%2Cserver_log_platform%2Cmessage%2Ckv&osFilter=sdk%2Cttnet%2Cpcnative%2Clinux%2Cmacos%2Cwindows%2Cios%2Candroid%2Cunknown%2Cvc%2Crooms%2Cweb%2Cvulcan&searchLogDisplay=wrap)

1. 首先确认用户问题发生的时间点和问题表现，这个用户是在2023年1月3号16:48 \~ 17 点左右这个时间打开加载慢

2. 我们需要用 request completed 查看资源的请求情况，找出是哪些资源慢影响文档打开的速度

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZDBmYTJkNmEyY2QyOGE4NWExOTZmZDM2YjE5MjA2YWJfYzI5YWI3MDYyNzNmYjg5NGMzMjA2Mzk0ZGViYjZiMGZfSUQ6NzMyMDEyODU2MTI5NzYwNDYxMV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

可以看到整个request completed 查处来的内容，包含很多内容

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YWMzNGM2OWVhMDc1Nzg5YzMyMDAxYzk4MDJlZDY0NTFfMWYzYmM4NGRlNGQ2ZDg4ZDA0MjM4OTgyNTFmMjdiMDFfSUQ6NzMyMDE0OTQzNDk4MDY5NjA5Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

我们首先需要找出请求完成（request completed）且没有走本地缓存（ was cached false）且耗时很长（total time cost: ）的资源\(\.js/\.css\)，我们可以很明显的找出有问题的请求，其中direct proxy true和proxy DIRECT都是没有使用代理的意思

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=M2ViMTc3NzY1MjllNWFiNmQ4MDE3NjRiZTIzMzdlNDRfMjkzMDRiNTczOTRlMjdmZjg1MDM4NWNiNDA2NGM3YjBfSUQ6NzMyMDE0OTQwNzkyNDk0NDg5OF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

可以直接观察这个request\_id的情况

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=OWQ0Njg5ZjkyMjUwY2FmNmY2YmZlNGVjYzY5ZDAyZjVfNWU0MjcwMGRkNTU4ZjIwOTA0Yjk4ZjFlNjk5MjFmYjlfSUQ6NzMyMDE1ODQyOTU0Nzg4ODY0MV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 找出慢的资源后，我们需要找出慢的原因包括是否跨网跨境，首先找出远端ip和本地出口ip

一般情况我们需要观察nid（netlog id），request\_id， tag\_id，error

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZDcyMmQzZTJkZmE4NmNhYzdmMTM5YzJiN2JlOWRhN2ZfMGMwZTZkZmFlNmJjODZhNGJiMWYyNDM5Njk3ZWY0OTBfSUQ6NzMyMDE1MTcxNzM5MTUxNTY1MF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



3. 找出慢的资源后，我们需要找出慢的原因包括是否跨网跨境，首先找出远端ip和本地出口ip

    点击耗时长的记录的右下角可以看到请求的具体信息，可以看到这个请求的具体信息，包括 X\-Response\-Cinfo:客户端出口 ip 和 X\-Response\-Sinfo:服务端 ip，通过 https://www\.ip138\.com/ 查询ip信息，发现两个 ip 不是同一个运营商的，说明跨网了

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MTdkYTQwZmVkM2U5YzRkZTkxN2Q4NjEzZmExMGQwZTFfZTUzMDdiNmIzZGRmNzZjZTU3ZGY1MzY5YjI5YmFkMDNfSUQ6NzM1NTgwODUyNzQ5OTIxNDg1Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

结论：根据上面的查询，用户很有可能是因为跨运营商导致的问题

正常情况还要用其他命令查看用户的网络情况等，这里不一一列举

### 如何分析dns有没有问题？

表现：

- 页面打不开

    - 如果直接显示dns 相关的报错信息，直接在问题文档先查询 [【外部】Web 端网络问题排查指南](https://bytedance.larkoffice.com/wiki/wikcnoGNgL5uE22BzxPtjlBg7sg) 

- 打开很慢



#### case1：如何查看丢包情况和 ip 解析情况（忘记是哪个oncall群了😓）

1. 查找有问题的域名 

    1. 打不开：主域名有问题

    2. 打开慢：需要打开 network 看具体请求慢的域名

    3. 命令的简单介绍

        - nslookup \(全称 name server lookup\) 域名服务器记录（NS记录用来查询该域名由哪个DNS服务器来进行解析。） [nslookup 入门命令详解](https://zhuanlan.zhihu.com/p/361451835)

        - Ping ip

        - tracert（跟踪路由）是路由跟踪实用程序，用于确定IP数据包访问目标所采取的路径。

2. 终端输入：nslookup 「domainname」，查看映射的ip，是否是多运营商或者多出口

    查看nslookup的截图的服务器名称和地址，下图为case，服务器名称很有可能是自建的dns，可以改为公网dns试试

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NDY3M2ZhMzUxYWRlMDBjYzRmZTQwYmY1ZjA0MTU2YmRfZTczMDg2MDIyOTUwMTJiYTNjYjQ4MDY5YjkwMjRjNmNfSUQ6NzMxOTc2Nzk1OTU1MDQ3NjI5Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 本地ping ip看是否能重现丢包情况

    1. 只有用户测丢包：说明是用户本地有东西拦截，比如防火墙，安全软件等，影响了包的接收

        1. 这种情况需要用户自查，一般是他们企业内网及公网出口的问题，CDN节点的可用性是没有问题的，如果实时抓包并且可以复现的话，可以更好的查看问题

    2. 我们也能重现丢包问题：说明是ip节点的问题，dns解析出来的ip接入有问题

        如果用户的dns有问题，建议尝试修改成公网的dns，但是有时候客户侧无法接受修改dns的方案方案，查看该服务器是否是上游线路服务商的，先让用户咨询上游运营商能不能做修改，如果不行转入网络中台，让网络中台的同学介入

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YmRiOTAyNTEwYmY0ZmM2NDMwOTI2ZGY4MmNiM2NiZWJfZjhmMDdjODA1NGUwYTJkNWUyYjI1ZGVmMTllZTg2NDNfSUQ6NzIxMDY4MTg1MDQ2ODI4NjQ2NV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NmI1MjA3ZTBlMGQ0YTZhODc5YzcxOGIzNTIwM2VlMGFfYTkyY2M2OGJkZDNmZjZmYzE1MWRlMzlkMDg1MzNiYzBfSUQ6NzIxMDY4MjAxMzAwMjA3MjA2Nl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

4. tracert \-d \[慢域名\] 查看请求的链路

这个请求里面有跨境访问，且跨境的速度慢的非常明显，正常都ip应该是国内通国内、海外通海外，且在同一个运营商下

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YmY0MWMxZWZkYzIzNDMwYjc2M2Q4YWYzZjYxZDlkMzRfZjJlNDRlMmEyZTUyZTM2MDc1NmU0NjAzMmZjZWE0N2RfSUQ6NzMxOTc3MDA0OTc0Mzg2MzgwOV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

### 如何处理 DNS 问题

- 确认是dns问题后，可以给用户发送dns自查文档排查，里面的解决方案有具体的指引

    - DNS 如何修改：[【外部】DNS 解析自查帮助手册](https://bytedance.feishu.cn/docs/doccnMOTyXXsInQDeJs9VfNaoPd) 

- 外部网站修改dns的网站（如果用户无法打开飞书文档）

    - windows https://zhuanlan\.zhihu\.com/p/265364903

    - Window 10 https://zhuanlan\.zhihu\.com/p/377418585

    - Mac https://juejin\.cn/post/6967503224819417096

- 其余网络问题自查文档：

    - 需要更多信息判断是否是dns问题，可根据这个文档自查：[【外部】文档访问慢/打不开自查手册](https://bytedance.feishu.cn/docx/doxcnjXzm7yf0qvBaEJqdcVCnph) 

    - Chrome 页面的常见报错问题可以查看这个文档，每个问题都有对应的解决方案：[【外部】Web 端网络问题排查指南](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh)

### 如何查看是否有使用代理

> 正常情况，飞书医生检测和net\-log日志也都可以直接看出来
> 
> 

windows自动代理：https://www\.win10h\.com/jiaocheng/44292\.html

使用飞连场景；代理对h2的支持不好。代理类问题一般需求客户的IT进行优化解决，H2支持问题可以关闭H2，强制走H1进行测试。

#### case：ipad中用户MS下文档名字没有更新，web端更新了

1. 这个问题是偶现问题，iOS端出现异常的时候，请求文档标题的接口\([https://bytedance\.feishu\.cn/space/api/meta/batch](https://bytedance.feishu.cn/space/api/meta/batch)\)请求失败了，预发环境和正式环境都有复现

    从目前的排查结果来看，目前判断是iOS客户端请求网络接口可能会随机请求错误。存在"（NSURLErrorDomain错误\-1。）"报错的网络请求都是同类问题。

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NWQ3NjAyMWYwOTRlYWE2M2RjM2NhZTg2ZjljMjIzM2NfM2ZkNWVhZjk0Njg3OTdjZDIwMGNiMTY5NDlhN2I2M2RfSUQ6NzIyMTQ3MTU1MzkxMTk0NzI2Nl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

2. 先查询了TTnet[TTNet介绍](https://bytedance.feishu.cn/docs/doccn7yhICaG9ELe5YRDkGjXN5c?bk_entity_id=enterprise_950) ，客户端这边日志是显示GOAWAY frame里携带的错误码是0x1，也就是协议出错了，而GOAWAY帧是服务端发过来的，跟客户端无关，如果业务server能拿到logid，能否查查链路上其它节点server是否有出错。可能得找找tlb或者mesh 看看这种关闭码是哪里发出的

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MjlhZWEzMDAwNTJiNDYzZGQwZDQxY2IxMWJkN2QyZDNfZWUxZmMzMzE1N2Q5MmIwZjIwMWJlNzRlZDViN2MxMjRfSUQ6NzIyMTQ3MjE3MjM3MDM0NTk4Nl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 由ccm/网络这里给tlb提oncall，根据x\-tt\-logid和具体的时间节点查询是否是tlb层有问题

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZmI2OGQwN2M0ODM5NzVkMzg3ZDllOGY2MTA2OWQ4YzJfZGQ0Zjk1ZGU4ZTUwZmFhM2Y0MzdkNzc2MDQwYmVmOTNfSUQ6NzIyMTQ2Nzc1MDMyNjE0MDkzMl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

查看CIP（client ip）

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZmQ2OTk5YWQwODQzNGRjZmQzYjUyMjllOTExZWJkZTZfMWFkYWY5MTI1MzUxYmMyYTg2NGE4NmNiNDljNWJiYTJfSUQ6NzIyMTQ2NzU4OTkyNjgxMzcwMF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



#### case2: KDM 反馈人在国外VC打开正常，浏览器打开很慢

\[chrome\-net\-export\-log\(2\)\.json\]

从 net\-log 日志分析是电脑本地开了代理，走代理网络出口就到了 [114\.55\.29\.68](http://114.55.29.68)，看代理是使用的 pac 脚本，一般是代理软件配置的，可以看下有使用什么代理软件，关闭一下就行

飞书客户端内做了修改，需要手动配置才生效，不会自动发现电脑代理

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MDg3ZGNlZjk2ZWY4MTViOTk5MWNhOTY1ZTQzZTdiODRfZjlkNTkyM2E0ODU5ZjRmOTZlNjVjZmE5YzY1MjY5ZTdfSUQ6NzMyNTM3MzQ4NTIxNDI4NTgyOF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZDJmNzYzODUyN2Q5MzE3YTFmMDkxNmRlMTM4YjUxNjdfYzdjMmE2OWZjZDI4ZDQ5OGYxY2Y5YThkMTUzMmQxMzRfSUQ6NzMyNTM3MzMyNzQ5NjcwODA5OV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

### 如何进行网络检测和抓包

网络检测文档：

[飞书医生（诊断套件）使用说明（用户版）](https://bytedance.feishu.cn/docx/VuZ8dyM31oHgiZxHNtpc2By4nQd?scene=multi_page&sub_scene=message) （最新的包）

mac抓包参考：[Wireshark 网络抓包](https://bytedance.feishu.cn/docx/FOkgd68wLoJphWxUusecTEDTnFc?302from=wiki) 

// todo 抓包分析



### 如何分析chrome net log

参考：[查看 net\-log 日志](https://bytedance.larkoffice.com/docx/OmgndObGXodEYbxu0wCcH7AxnEh) 

深度学习可查看 chromium 的代码，里面每个字段的释义 [source\.chromium\.org](https://source.chromium.org/chromium/chromium/src/+/main:net/log/net_log_event_type_list.h;bpv=1;bpt=1)

外网学习地址：https://zhuanlan\.zhihu\.com/p/266622278

**Chrome net\-log 查询如果是文档打不开，应该主要查文档的主域名，如果是打不开，着重查 "lf\-scm"和"internal\-api"这两个关键词**

1. https://netlog\-viewer\.appspot\.com/\#import导入日志，查看用户是否有使用代理

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NGJiNWM1ZTc3MGM1MWQwMWIyNjNlYzA0ZWZmOTg5NzVfYzJmZmE3MTVkMGM2MWRhMWZiMmU0OTA2NjhlZDkwMWNfSUQ6NzMxOTc3MzUyMTA5NzQ0MTI4M18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

2. 查看event，查找有异常数据的event，SOCKET  链接是针对域名的，比方说 [A\.com](http://A.com) 这个域名建立连接之后，也就是一个 SOCKET 链接，那么这个域名下的所有请求，都会算到这一个 SOCKET 连接里面的，SOCKET\_ALIVE的时间代表这个域名建立连接的总时长，所以没有清缓存或者打开多个tab的话，也会被记录成在SOCKET\_ALIVE的时长里面

3. 观察TCP\_CONNECT时常，SSL\_CONNECT时长，SSL\_CONNECT完成时长，如下图，TCP\_CONNECT很快，SSL\_CONNECT的连接时长为63\-27 = 36ms，属于正常时长，但是SOCKET\_IN\_USE的时长偏长，

    - 有两种原因：

        - 录日志前没刷缓存，导致数量累积

        - 该域名下的请求很多，但是如果请求时间都正常的话，也属于正常现象

        - 的确是每个请求都花了比较多的时间

    具体是什么原因，需要转入request查看具体数据

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MmQ3Y2FmMmUwNjBlYWI3YTA4NjE1OTQ3YjU2MjM5YzFfMTQxYzQwNTc0ZmEzNTE4MzhlNzFmOWEwYmY5OWM2NWVfSUQ6NzMxOTc3MzUyMDkwNzg5NDc4OF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=Y2QyOGM5ZDYzYmJmYjA2NTRmYmY5OWZiOGY3MWQ1MTZfOWM2ZDI2ZTcyMmNhMGQ0NWNhZjdiYjQ0MjNkZWMyNjlfSUQ6NzMxOTc3MzUyMTA5NzQ1NzY2N18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

4. 查看request数据，定位当前域名，查看CORS\_REQUEST的时长，1s左右就属于时间偏长，

    以下面的数据为case，该域名下的请求大部分时间都在1\-6之间，说明该链路存在问题，如果这个CORS\_REQUEST都比较短，那之前的SOCKET\_ALIVE时长就可能是缓存引起的，接下来要查找到底是哪部分导致CORS\_REQUEST耗费了时长

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MmUwY2Q5MzU5NmNkMzA5MDg0NTlkZGQxOTE0YTYwNGZfY2RhNzQ0NzUwZjY1ZWM5YWJhYTY2MmVlM2JjYTQ5ZTRfSUQ6NzMxOTc3MzUyMTU0NTI0ODc3Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    通过request的详细数据，可以发现HTTP\_TRANSACTION\_READ\_BODY到HTTP2\_STREAM\_UPDATE\_RECV\_WINDOW的时长突然激增，可能有两个原因分

    - HTTP\_TRANSACTION\_READ\_HEADERS 到 HTTP\_TRANSACTION\_READ\_RESPONSE\_HEADERS的时长，该数据表示web端接收到server回包的时长，这个数据和链路有关

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YzJhZjBhODg2ODBlOWJhNmQ5MjI1N2IxMDg2NzU4NWNfMjBkNDRlMzllYWE0ZjM2ZmYwNDk3ZDBjNWMwNWQyMzVfSUQ6NzMxOTc3MzUyMDk5ODY3ODUyOV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    HTTP\_TRANSACTION\_READ\_BODY到 HTTP2\_STREAM\_UPDATE\_RECV\_WINDOW的时长，该时长为数据传输的时长，该时长跟数据包的大小，网速有关

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=OTExMGRjYmM4YTE1NGQ0ZDY4NTNiNTFkOTYyNTAxOGNfZjc4MjMyNGY5YTY3OWI5YTlmYjBlMmRlYjA0ODY0YTlfSUQ6NzMxOTc3MzUxOTQyNzQyMDE2MV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

HTTP2\_STREAM\_UPDATE\_SEND\_WINDOW说明是回包比较慢，也是跟网络状态和安全软件有关系

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MzRkNmY4NDVkMjgxNjBlNmYwNmUwNmFkZjcwM2Q3OWVfYzE4N2FjOWNmNmM5ZDFlYWVmZDZmZGI4NGU5MDAwNGFfSUQ6NzQ3ODY1NjkxOTU3MDI1MTc5NV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

5. 检查网络情况（timeLine）

    哪个时间段？

    request的start time\+有问题的节点时间，下图case的时间是，10\.51\.51\+2s  ，所以应该查看10\.51\.53左右的网络情况，可知，当值用户的网络状况非常不稳定，网速也很慢

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MWNlMjEzZTFhOGQxNmZlYWNhMGZkNTlkYzRlMTIxZWJfNzRmYTNlYTM0ODYxNzVmNTY2MmRmMmY0YjhlZDkxMmJfSUQ6NzMxOTc3MzUyMDk5ODY5NDkxM18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWE2YTlhNTA1MWU3MWI5YjI0OWNkZDNkMjc2MDM5YzFfMmMxNTU1NzQxMzE4ZmUyMTRkZTNiNWExNDE5Nzc1MzNfSUQ6NzMxOTc3MzUyMTUzMzMwNDgzNl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=N2FlNjY4NzVjYzhiN2ZhMzljYjU1YjNjNDViYmI0ODBfZGM4MGM4ZGM3MmYxNmY0NTQzOWNmYzQxMTRmNTM3Y2FfSUQ6NzMxOTc3MzUyMDkwNzg3ODQwNF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

结论，网络慢的原因主要有两个

1. 域名到ip的链路有问题，时间过长，导致web端接收到sever包的时间很长

2. 用户网络不稳定，导致数据传输的速度很慢

其余信息

- 在event 里面输入type:socket 查看域名解析到的 ip 具体是哪个

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZGRmZjJlYmY2MGRiZjdlZTQ5NDY2YzE5NWM2N2M4MjJfMjA3YWIwMGI5YzRmZDFjNTUwZTg0NjNmOGJmOTNlMjNfSUQ6NzM1MTM0MDM0MTMzNTkzMjkyOV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

- 查看请求的桌面出口ip（cip）和远端ip（remote ip、connected ip）

    在event 里输入：type:request 找到请求的资源，查看HTTP\_TRANSACTION\_READ\_RESPONSE\_HEADERS ，里面有很多信息，包含了出口ip和远端ip

    但是目前这个字段只有在URL\_REQUEST\_START\_JOB  里面的 load\_flags = 0 \(NORMAL\)的时候才有， load\_flags字段的含义可以查看 https://source\.chromium\.org/chromium/chromium/src/\+/main:net/base/load\_flags\_list\.h;drc=9910d3be894c8f142c977ba1023f30a656bc13fc;l=18

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MGE1ZDA2ZjliNzM3YzVlZDE2ZTgwZjI5YWVmYWM2MDBfM2I5MjlkNDlhNzZkNzNiNWZjMWM1ZTJjZjk2OTVlMjZfSUQ6NzM1MTM0MzQ2NjYxMDQ3NTAwOV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=Yzg1OTAxZjM2YjQwZDNhNDQ2ZjY5YTM1NzQ2ODZjZGNfNjQ5OWRkYTFiMGExNGJhY2U1MTE4YThjNTM0MWZlMTZfSUQ6NzM1MTM0MzUxMDE1MzE1MDQ2OF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    



- 查看请求具体过程，点击查看（**\(HTTP\_STREAM\_JOB\_CONTROLLER\)**，可以看到这个请求是否有走代理等其他信息（ps：其他链接都可以随随便点点）

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MjNkYjljODAwOWFkZGU0NDE5ZTI1YWFiMThjN2YxMDRfNzZkNmYxZmMzMjAzMDVkZjM1MmZkM2U1Yjc1MmI1ZjVfSUQ6NzM1MTM0NjEwNjk1MTI1NDAxN18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YzI4NmVkZmVlNjk0ZTczY2UwYWMzNjg2OWI4ZjYzYTJfZDg5Nzk2YTA4ODc0OTkxYzQwMTdhMWQ4NjcxOGI3YjNfSUQ6NzM1MTM0NjAxNjU5ODE0NzA3M18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



- 看资源是不是读的缓存

    1. Request 如果是出现http\_cache\_read\_data，说明读的缓存

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZDE1ZmViNDBmYWIxNmE2NWY0Nzk3NTliNTk2YjI2NTRfY2FjYjNmMmEzZTg3ZWNmOTE3OTI2Y2QwZTE5MTg1M2JfSUQ6NzM1MTM0NjgzNzA5NzcyNTk4MF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

### 如何查看租户流量问题

> 用户反馈流量在某个时间异常时候需要对租户流量进行排查，找出流量异常的原因
> 
> 

[CCM 流量带宽问题排查 SOP](https://bytedance.sg.larkoffice.com/docx/ZxuQdcwApoWLAyxTCJIlPp2kgMe) 



### 证书问题

#### 打开提示链接不安全

证书类的错误码主要是非\-202和 \-202，非\-202的证书问题，一般会有直接的提示，根据提示操作解决，\-202的会比多样，主要是只电脑或者客户端不信任收到的证书，

- 证书劫持 替换了证书； \-202一般是证书被劫持，可以查看详细日志中ssl模块中的issuer名称给客户提供线索，请客户自查，另外一直情况是根证书缺失导致，可使用飞书医生进行修复。

- Wi\-Fi登陆未验证具体可参考文档

排查指南：[【windows版】本地缺失证书导致的\-202问题（页面空白，加载失败）自助排查以及解决](https://bytedance.larkoffice.com/docx/JQcddtLR4o7DqGx9EBncYxhtnmd) 

解决文档：[飞书webview证书劫持类问题排查和解决指引](https://bytedance.larkoffice.com/wiki/W0NwwrVh7iQ9FwkN50WcyIIfnJd) 

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YzAwZDQ5ODUzOWViNDI0Y2Q0MTJkNjBmMjBlYTQxODFfMWUzOWU4YjQ1ZGYxNjczYjVkNGE2M2IzYzhkNWYzY2RfSUQ6NzI5ODI2MzUxNzYxNzYxODk0Nl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ODNkZmRlZTFkYTdlNGJmMjgzM2YzMzUzZjQ3NGQzYWNfNTI5OWEyNWRhOTVlOWI5NmRlZTg1Zjc5MWUyOWI5MmFfSUQ6NzI5ODI2MzUxNzQzNzAxODE0MF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

#### 用户想其他app使用飞书的根域名证书，目前飞书不支持的

### 如何判断是防火墙问题

[飞书防火墙问题排查](https://bytedance.feishu.cn/docs/doccnjcqiclG8ZBMl5Nx0thtRzd) 

[飞书网络\-防火墙问题排障思路](https://bytedance.larkoffice.com/docx/Xp05drU7HovO1ZxV4sgcfwWMnPg) 

**快速定位：**

1. 使用手机访问是否正常，手机正常的话大概率是防火墙，

2. 日志上有防火墙的 错误码报错（详见客户端错误码）

3. 关掉防火墙后恢复正常

**解决：**

- 常见防火墙、安全软件拦截，给防火墙设置白名单就可以解决

- 无法配置泛域名的防火墙：目前确认不支持泛域名的防火墙为山石防火墙，山石防火墙自带飞书应用识别能力，能较好的支持飞书主要功能使用。但由于该防火墙策略不支持泛域名的配置。可以结合IP白名单将VC等业务场景的IP地址池进行放行。再结合防火墙的拦截日志，将防火墙上的飞书应用无法覆盖的域名进行加白。这种算是最佳目前最佳使用姿势了。

- 配置白名单后还有问题可以考虑是部分防火墙无法感知dns解析流造成无法加白（比如：华为系列、checkpoint、天融信、飞连），防火墙是否需要感知到dns解析才能对加白域名进行放行，这种情况需要为客户开通localdns优先进行测试。[飞书/Lark租户维度定制化\-\-Local DNS优先](https://bytedance.larkoffice.com/docx/Oe49dgcYEoFxKrxLrmfuPu8LsGc) 

### 如何判断跨运营商（跨网）问题

[跨运营商问题排查指引](https://bytedance.larkoffice.com/wiki/wikcnCCLyaaWYDyvLiPNEkSzM7d) （内部文件不能直接外发）

#### **Q：为什么只有飞书会跨运营商，其他应用不会？**

**A：**我们目前没有提供 BGP IP （友商是，所以他们可以覆盖大小运营商），我们是使用cdn加速完成最后一公里接入的，对应的节点是根据客户端的运营商网络进行分配的，如果客户端的ip和远程ip不是同个运营商就会有跨运营商的问题

#### **Q：什么是跨运营商？**

**A：**用户的桌面公网出口ip（cip） 和解析到的的远端ip（remote ip 、 connected ip）不是同个运营商，即为跨运营商

- 比如用户的出口ip是联通，请求到的远端ip是电信或者移动等，都属于跨网行为；

- 三大运营商（移动、电信、联通）之间跨网一般情况都会比正常请求慢；

- 除了三大运营商之外的统称小运营商，如：皓宽网络、皓宽网络等等；大小运营商跨网访问，会直接影响访问的质量，有时候甚至会导致请求失败；

- 跨网不是100%会导致访问慢，具体还得看跨网的资源耗时和没有跨网的资源耗时做比较来证明是不是跨网导致的问题；

- 如果发现跨网的行为，就算本次不是导致访问慢的具体原因，也需要建议用户处理，否则可能在以后会影响访问的速度

#### **Q：如何判断是否有跨运营商问题**

如果用户是在端内使用，用户的公网ip和请求到的远端ip都可以在 logifier 查到

1. 使用 "request completed \& \[域名\] \& total time cost" 找到 total time cost耗时长的请求，找到该请求的request id , on connected ip info 49\.79\.224\.240:443 就是这次请求到的远端ip，然后查询ip的运营商信息 https://www\.ip138\.com/

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NWVlNDUwZTgzODczMzE0MjU4OGI3ZTZhNDVmOTc0ZDdfYjNmNmQzZTYwNzc2MzQwN2M2NjFmZGY5ZmZiNzk5MjBfSUQ6NzM1MTI5NjY5MDQyNDQ2MzM2NF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWFkYzllNGVjNmFmMzkyNTFmMWZiYzM2MTc4OGVmZTJfNDIxMjkyZDFlYTQ4ZDk3OTUxZjVkMDkzNzNkNDRjNjBfSUQ6NzM1MTI5NjgwOTc0NTIzNTk3Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

2. 输入 "x\-tt\-cip"，静态资源可以输入"x\-response\-cinfo"进行 double check，找到比 connected ip 时间点更早但是最近的ip，如上图 时间是12:28:14\.172 ， x\-tt\-cip查到的最近的是12:28:04\.356 ，然后查询ip的运营商信息 https://www\.ip138\.com/

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MTRjODg4NDdjMzllMjJiN2MxZDkwOTcwYjAzNjc3OGZfNjM1ZDg5NjZjZmRjNTMyNjcxZTQ3ZDIxNzc4NjRkM2FfSUQ6NzM1MTI5NzU1NzAwMTY4Mjk3Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 或者 找到了耗时长的日志后，打开该日志右下角的窗口，查看header的信息，查看这两个ip是否有跨网

X\-Response\-Cinfo:客户端出口ip

X\-Response\-Sinfo:服务端 ip

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZmQxNjEwNzg3NjUyZjZkZDYwMWU5YzU3NTFlNjkwMTdfZDZmNzgzOGU0ZTc1OWVhNzZiNGI4OTkyOGI4ZmMxOThfSUQ6NzM1MTI5OTEyMDQyMDI0MTQxMF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MGU5NjRjZjMxOTNlYWQ4MTBjODU4NTY3NGZiNDllYmFfZjM0ODQ2ZGY5ZGIyYjg5YjMyYjkzNTE2MDBmNjYxZDVfSUQ6NzM1MTI5OTM5OTg5NzEyMDc3Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

如果是在web端使用，只能根据请求具体时间查看cip

- 查看 netlog 中request的 header信息，其中的X\-Response\-Cinfo和X\-Response\-Sinfo字段

    - 找到CORS\_REQUEST 耗时长的资源，查看 HTTP\_TRANSACTION\_READ\_RESPONSE\_HEADERS ，里面有很多信息，包含了出口ip和远端ip

        但是目前这个字段只有在URL\_REQUEST\_START\_JOB  里面的 load\_flags = 0 \(NORMAL\)的时候才有， load\_flags字段的含义可以查看 https://source\.chromium\.org/chromium/chromium/src/\+/main:net/base/load\_flags\_list\.h;drc=9910d3be894c8f142c977ba1023f30a656bc13fc;l=18

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NjdhNThjNjgxMWFhOWNkYjJlY2FiMjY3Yzk3YTUzNzlfMTZkNjljOTgzZTJkZjlkNjdhODM1OTlhYzhmYzJhNzJfSUQ6NzM1MTMzMzYzODI3MTg5MzUwNl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

        

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MDliN2VlZTRjOTllZjRmNzQ0MDgyZWIyOWNhMDU5MWJfZmUxYTc3OGYwMTAxNGY2MDZjZWU4NzYwYTIyNzE4ODJfSUQ6NzM1MTMzMzY0NjMzMjM2Mjc1NF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

        

    

- 如果找不到这个netlog 里面 使用type:socket \[域名\] 查看 域名请求到的远端ip是什么，再结合logifier 的"x\-tt\-cip" 找到对应的时间点的ip，对比来看是否有跨运营商

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NDk4N2VlYmE3MzcxNjBmZmI2YzNjZmZlODY0OTM5YzdfYmFjNzcxODE0OTQzYzMwMTI1NWJiOWRlZjY5Yjc4ZDhfSUQ6NzM1MTMxMjk1ODIzNjM2MDczMl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

- 还可以通过 type:request \[域名\] 中的 \(HTTP\_STREAM\_JOB\) \-\> HOST\_RESOLVER\_MANAGER\_CACHE\_HIT 查看命中的ip list 来判断是否有跨网

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YjI1ZWEwNTdhZDgxZTkxYjFhNTdjZDk0NDYwZjgzNzJfNTQ5YjlkMDYyZWZjMmUwODQwODYxMWU0MmRlMmNlZTZfSUQ6NzM1MTMxNTMxNTYwODk5Mzc5M18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MWEzNzgyMjBlNzdjOWRiNGJjNDlmNGI1MDk2ZGUwYjZfMTFmMzBiMDlmMmE3MDg0MjdhNWY5MDc5YjNkMWJjYmRfSUQ6NzM1MTMxNTM0MTE4NTI4NjE0NV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWM0MzE1MTllNDI3MmVmYmZkNTYyMzVkNGIxZTUyN2RfZTZmNTIzODMzN2FjMzJiZDljMWIyMjNiODJmMGE1YzFfSUQ6NzM1MTMxNTM1NDU5MDY5MTM1Nl8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

    

#### **Q：跨网是什么原因导致的，以及如何解决**

**A:** 出现跨网的现象主要是 DNS 解析问题

- 可以尝试修改成公共dns 来修复，具体可根据本文档的「如何处理DNS 问题来修复」，其余文档参考：[跨运营商问题排查指引](https://bytedance.larkoffice.com/wiki/wikcnCCLyaaWYDyvLiPNEkSzM7d)、

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=YTNmMjU2Y2ZkM2JhNmYxYzQyOTdmZWFmMmIyMTEyNWZfZDY1YmJjMGY1M2NlMGIyN2E1MjFjYTRiNWQ0ZGNmZWRfSUQ6NzM1MTMxNzI5OTcwNDE2ODQ1MV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

- 如果用户公司的网络架构是使用多运营商的，需要让用户 IT 将 飞书的域名限制成不跨网访问，保证飞书域名的桌面出口ip和远端ip是同一个

### 如何判断是跨境问题

飞书的资源部署在国内的服务器，lark的资源部署到海外的服务器，所以飞书远端 ip 都应该在国内，lark的远端ip都应该在海外

#### **Q：什么是跨境**

**A：**国内使用飞书请求到非中国大陆的ip、国外使用lark访问到中国大陆或者离该国家很远的ip（如果非该国家的ip需要资讯网络中台是否形成跨境）这两种情况都是跨境

#### **Q：如何判断是否有跨境问题**

**A：**跟排除跨运营商问题一样，都需要找到桌面出口ip（cip）和解析的远端ip（remote ip、connected ip），具体怎么找这两个ip的信息，可以参考本文档的「如何判断是否有跨运营商问题」，找到两个ip后，在https://www\.ip138\.com/ 查询ip归属地是否有跨境

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MzVhYWQ4YjgxNzgyZWMwYmM5YzQ3NjFlNmExMWY2OTNfNmE4OTBhM2UwYTYyNDlmNTZlNTQ1MTZiY2Y2OWViNWRfSUQ6NzM1MTMyNzc2NzI0ODc2NDkzMV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

#### **Q：跨境问题如何处理**

**A：**处理跨境问题首先要确认用户是否有海外出口，这点可以通过 https://ip\.skk\.moe/ 辅助查询

- 如果用户没有海外出口，但是解析到了海外的ip，就是dns解析的问题，可以通过修改dns修复（无论是飞书还是Lark，这种情况的跨境问题都是dns解析的问题）

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=M2IyNGY1MTk2NGVjMmY5ZjQ0MzFlNzk5OTYyMDE0MTJfZDJhODM0YTNkN2ZhM2VhZjlmNjg2OGZhMDE4NjdkODlfSUQ6NzM1MTMzMDczNDg3MzY5MDExNV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

- 如果用户在国内使用飞书，有跨境出口，需要用户设置飞书的域名只走国内：[配置企业内网防火墙域名和白名单](https://www.feishu.cn/hc/zh-CN/articles/360044683233-%E9%85%8D%E7%BD%AE%E4%BC%81%E4%B8%9A%E5%86%85%E7%BD%91%E9%98%B2%E7%81%AB%E5%A2%99%E5%9F%9F%E5%90%8D%E5%92%8C%E7%99%BD%E5%90%8D%E5%8D%95)

- 如果用户在海外使用Lark，有跨境出口，需要设置Lark的域名走海外：[配置企业内网防火墙域名和白名单](https://www.larksuite.com/hc/zh-CN/articles/360044784554-%E9%85%8D%E7%BD%AE%E4%BC%81%E4%B8%9A%E5%86%85%E7%BD%91%E9%98%B2%E7%81%AB%E5%A2%99%E5%9F%9F%E5%90%8D%E5%92%8C%E7%99%BD%E5%90%8D%E5%8D%95)

#### Q：国内使用Lark、国外使用飞书如何处理

**A：**最终是需要让lark都请求到海外，飞书都请求到国内

- 用户在国内使用Lark

    - 付费用户建议开通 China CDN，[Lark付费用户开通chinacdn功能流程规范SOP](https://bytedance.larkoffice.com/wiki/wikcnRO0CII7wKNUUBOc6MCh28X)；

    - 非付费用户建议case by case来看，不建议暴露有chinacdn功能。建议说明Lark主要是面向海外用户的版本，在国内推荐使用飞书。基于合规要求，Lark的数据存在海外，一定要在国内使用Lark的话，无法避免跨境质量不佳的公共网络问题，需客户自行调节网络环境以便正常使用Lark。

- 用户在海外使用飞书，目前没有提供类似 China CDN 一样的专线，只能建议用户自己使用VPN

- 用户使用自己的VPN或者代理时，ip还是有跨境

    - 在国内使用Lark 请求到了国内的ip

    - 在海外使用飞书还是请求到了海外的ip

    上述两种情况都可能是代理错误了，需要用户自查

- 在国内使用lark 多少都会比直接在海外使用lark慢，飞书同理，同时依赖用户的VPN/代理的质量和网络质量，这种情况也需要用户自查

#### Q：为什么访问的是飞书的文档，但是请求到了海外的域名

正常情况飞书的域名都会请求到cn的域名，比如：[lf\-scm\-cn\.feishucdn\.com](http://lf-scm-cn.feishucdn.com/)

海外的会有us\\sg\\jp这样对应的标识，比如：lf\-scm\-sg\.feishucdn\.com



如果访问的飞书的域名，但是访问了海外的域名，应该就是代理到了海外的ip



### 如何判断是CDN问题

[网络请求非200错误问题排查](https://bytedance.sg.feishu.cn/docx/FIEPdcloRoZT9RxZcwAlZH6rgWb) 

1. 怀疑是链路问题 case：[「2024\.1\.8」\- KDM 反馈文档打不开](https://bytedance.larkoffice.com/wiki/MgusweT2oiGjwWkqTf7cKLb2nJe) 

2. 如何判断和给ttnet 提单：[CDN 问题处理 SOP](https://bytedance.larkoffice.com/wiki/TrNPwkKdIiJPCVkpc5BcNHSCnKh) 

TTNet Request Log 判断 header 字段中的 server\-timing

- 有 edge 表示请求已经到达边缘，如果该阶段dur很大则表示有问题（大于1s都不正常，表示边缘有故障）

- 有 origin 表示请求已经正常回源，

- 有 inner 表示请求已经在源站处理完

如果少了哪个阶段可以反推排查。

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=M2Y0N2ZiZjFhNzQ1N2Q1Y2YyMTg1NTgwYWZkMjA2YzhfMTg2M2JkNGIyMGZjN2I1MDQwNzUyODgyY2MxYzEzZjlfSUQ6NzI5OTAwNzY1MDU5MjM1ODQwMV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

##### 如何判断ip是不是字节的

1. 在云诊断查询ip信息，能查到信息的就是字节的ip，查不到的需要进一步确认；https://cloud\.bytedance\.net/cdn/service\-suits/diagnosis/ip?x\-resource\-account=public

正常情况

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NzBkNjZjMWQ0Yzg5NTRhYTkyN2MzOWMzODMxMGQzZjVfZWNhZTY4YTZmZGRlNDExMzdhN2FlMmI2YjU4MjE3NjhfSUQ6NzM0NjA2MTI4NjA0MjIzODk3OV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

不正常的

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NDA2ZGVjYmZmNGIxOTJiOTNmMTlkYWIxZjYxNmMzZWVfYzYxYjBlOTMwMDUwNzc5ZWFmNzdlYThlMGZmZjEwMjJfSUQ6NzM0NjA2MTQ0OTY3ODMyMzcxNF8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

2. 在公网查询ip信息，海外的如果是Akamai的，可能是字节的，因为我们有使用 Akamai 的 cdn 服务，需要用户做一下 dig或者nslookup 看看是哪个cname解析出来的节点 （windows没有dig命令，可以在neslookup命令看到cname）

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWQ4NDgyODdmNmJiNTA3ZDgwNmJlYzRmYjM3NTY1MWRfMjY2NjhkNzMzYTRhYWYzYmUwMzQ4NjAyZWZlNTRhZDRfSUQ6NzM0NjA2MTkzMjg3NDY2MTg4OV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 拿到cname后，可以到 netlink 查询，https://netlinkops\.bytedance\.net/?content\_type=0\&content=nio\.feishu\.cn 能查到的信息说明是字节的，但是如果返回了一个有问题的ip，说明可能被劫持了需要给 cdn 提单资讯

    > netlink查源站信息，TLBVIP、以及一些直接给A记录，没走CDN的场景
    > 
    > 



### 飞书 ip 地址列表、域名等问题

无法提供ip地址段。（因为使用了cdn服务，IP节点随机的不固定，所以无法提供）。

但是可以提供域名白名单

白名单中的 ip部分是VC那边提供的，其他域名只有\*泛域名配置的时候正常需要把文档里面的域名和白名单都配置，

**Lark：**[配置企业内网防火墙域名和白名单](https://www.larksuite.com/hc/zh-CN/articles/360044784554-%E9%85%8D%E7%BD%AE%E4%BC%81%E4%B8%9A%E5%86%85%E7%BD%91%E9%98%B2%E7%81%AB%E5%A2%99%E5%9F%9F%E5%90%8D%E5%92%8C%E7%99%BD%E5%90%8D%E5%8D%95) 其中 larkoffice\.com 域名和新增网段已更新到飞书官网的防火墙白名单列表

**飞书**：[配置企业内网防火墙域名和白名单](https://www.feishu.cn/hc/zh-CN/articles/360044683233-%E9%85%8D%E7%BD%AE%E4%BC%81%E4%B8%9A%E5%86%85%E7%BD%91%E9%98%B2%E7%81%AB%E5%A2%99%E5%9F%9F%E5%90%8D%E5%92%8C%E7%99%BD%E5%90%8D%E5%8D%95)

[字节租户飞书二级域名由\*\.feishu\.cn 更换为 \*\.larkoffice\.com 通知](https://bytedance.larkoffice.com/wiki/Pg3twbQQWinfQRknGhEcLIeVnle)[ ](https://www.feishu.cn/hc/zh-CN/articles/360044683233-%E9%85%8D%E7%BD%AE%E4%BC%81%E4%B8%9A%E5%86%85%E7%BD%91%E9%98%B2%E7%81%AB%E5%A2%99%E5%9F%9F%E5%90%8D%E5%92%8C%E7%99%BD%E5%90%8D%E5%8D%95)

有过oncall的case 是有一些不在白名单里面的域名没有加到用户防火墙的白名单导致用户访问慢，如果有排查到类似的case，可以一起加入，比如：

- \*\.[byteimg\.com](http://byteimg.com) ,

- [athena\-api\.oceanengine\.com](http://athena-api.oceanengine.com)

**CCM需要用到的域名清单：**[CCM 对外提供域名清单](https://bytedance.sg.larkoffice.com/docx/TlYOdZlT6oWfQQxhKAwlxwVVgce) 

**如果用户想用飞书的域名进行测试，可以提供以下域名（海外的需要根据不同国家的在ccm域名清单里组合一下）**

租户域名：[~~mindray\.feishu\.cn~~](http://mindray.feishu.cn)~~  ~~需要根据租户变换
space\_api：[internal\-api\-space\.feishu\.cn](http://internal-api-space.feishu.cn/)
drive\_api：[internal\-api\-drive\-stream\.feishu\.cn](http://internal-api-drive-stream.feishu.cn/)
静态资源：[lf\-scm\-cn\.feishucdn\.com](http://lf-scm-cn.feishucdn.com/)



**静态资源域名**

正常情况设置\*\.[feishu\.cn](http://feishu.cn/)、\*\.[feishucdn\.com](http://feishucdn.com/)这两个就可以包含飞书所有的域名

静态资源总的有4个域名

0: "[sf3\-scmcdn2](http://sf3-scmcdn2-cn.feishucdn.com/)[\-cn\.feishucdn\.com](http://sf3-scmcdn2-cn.feishucdn.com/)"

1: "[sf1\-scmcdn2\-cn\.feishucdn\.com](http://sf1-scmcdn2-cn.feishucdn.com/)"

2: "[sf6\-scmcdn2\-cn\.feishucdn\.com](http://sf6-scmcdn2-cn.feishucdn.com/)"

3: "[sf3\-ccm1\-cn\.feishucdn\.com](http://sf3-ccm1-cn.feishucdn.com/)"

**文档相关域名：**

[CCM 前端域名梳理](https://bytedance.larkoffice.com/wiki/TBGvwToGwiChsmk7iKGcjycJnCe) 

### 常见的网络报错排查指引

Web 端网络问题排查指南：[【外部】Web 端网络问题排查指南](https://bytedance.larkoffice.com/wiki/wikcnoGNgL5uE22BzxPtjlBg7sg) 

### 域名加白需要 \.txt 文件进行校验

域名加白需要白名单校验，需要在文档域名的根路径加上一个txt文件，统一提 node oncall 研发处理

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=Y2ViNjY4OTk1M2NkODhlNzk2NzkyMTkzMmZkYWFiYTVfNTYxNmYzZmUwMDU0NTdhNDM0MWZmOTc0ZDc4MzY4YTVfSUQ6NzMxMTI2OTc4OTU2MDMyNDA5OV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MTY4YzlhZTUxMDI4ODFkMTQyMzAyZjIyYTU3ODRhOTVfOTVjMWUxYjdmZDRiM2ZkMTQ1Nzk4MmFhZGRlZDBjNzhfSUQ6NzMxMTI2OTkxMzYyMTAwNDI5Ml8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZTQ0ZGFmYzk4YmQzMDc3OWM5NDQ1MDBhMTU0MjA4YWJfMDgwNjE3MjhkODQ1YzYxOTU1YzJkNDA4MzkzNWIxZDVfSUQ6NzMxMTI2OTk1MDA1MDk5MjEzMV8xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)



### 浏览器插件问题，cookie报错等问题

[多环境 Chrome插件用户手册](https://bytedance.larkoffice.com/wiki/wikcnxl27hj7yQuIZ296TkTrtPf) 

todo： case分析沉淀

### wireShark  怎么分析

[抓包分析简单指导\(外\)](https://bytedance.larkoffice.com/wiki/EqBTw9yAti1BiFks5RYczs88nZ6)可以咨询@李佳霖



## KA用户网络问题处理

所有的ka问题，都应先让业务侧进行排查，确认是网络问题后才开始排查网络问题

### 什么是专版

专版是ka下面的一个分支，用sass部署，固定一个版本，不跟飞书一起升级，日志可以正常查

### 什么是私有化

KA用户的日志没有统一上报到飞书，所以slardar和tea无法正常查询日志

私有化访问文档的时候日志上报的接口会报错，符合预期，因为私有化没有部署日志

[Lark KA 应急协同找人地图](https://bytedance.larkoffice.com/wiki/NcMgwxPUqiQZBkkhrDTc0qGNn3c?sheet=f363e3) 

1. 日志查询：

    1. KA想查 Tea日志的话需要到对应的运维平台上查询且查询埋点都是单个单个搜索无法一次性搜索到全部埋点，参考[私有化oncall流程](https://bytedance.larkoffice.com/docx/Eqp8d1toIoF13qxySzicMST7noh) 

2. 飞书医生检测

    1. 需要使用飞书医生KA专用版本：[办公软件医生（诊断套件）使用说明（KA用户版） ](https://bytedance.larkoffice.com/wiki/X768w7YasiYK9Pk6vTcccRGfnSe?create=) 

    飞书医生检查的话不是看 [feishu\.cn](http://feishu.cn) 的域名，所以飞书医生检测出来的相关结果不一定可靠 例如：

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWI1MmMzM2FjZDIzYTU4MTRlMWQxZTk0NmU2OGRiZWRfMDFjYWU2ODczMjhhOWUxNmU0OTlhYTk1MzBlZDcwYTJfSUQ6NzMxNzE1NDU2OTc3MDA5MDQ5N18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MmYzZmE4ODk4OWQzZmNmMTIyMjRjOTlkMTg2MmQ1ZmFfMjE4MGExMDZlOWUxNDUwMTgzNTM2MDNlNzFhMjg4NDdfSUQ6NzMxNzE1NDYyNjQxMTA1MzA1N18xNzgxMDgyMTIzOjE3ODExNjg1MjNfVjM)

3. 命令行网络信息收集和飞书普通用户一致

## 移动端日志如何查询

移动端的网络oncall总体数量比较少，之前的sop是由@张桂霞接手排查，只能根据通过之前的case 总结一下了🙏[移动端oncall问题](https://bytedance.larkoffice.com/wiki/Fxn0wtHPliJIlckwFTrcGoZ9nch)

总结了一些手机端的经验：[移动端网络oncall 排查](https://bytedance.larkoffice.com/wiki/PbqfwxerSiD2HiktWmbc9sDfnlg)

### 特殊Case 分享

#### 联通 ipv6 跨省导致的资源加载慢的问题，ipv4 不会有这个问题



