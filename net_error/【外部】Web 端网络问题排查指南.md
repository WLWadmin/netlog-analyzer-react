# 【外部】Web 端网络问题排查指南

**引导用户按照文档中的步骤收集信息** [用户反馈信息收集](https://bytedance.us.feishu.cn/docx/doxusOkv2f8oj6B8n62qWMQX98g) 



浏览器常见网络错误可参考下面的解决方案。

**建议使用 Chrome 浏览器**。



# 常见 Chrome 浏览器报错代码

## DNS\_PROBE\_FINISHED\_NXDOMAIN

**Chrome 浏览器报错：**

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=Mjk1ZDg1ZTlhN2M1N2ZiOWI0ZDQ3ZTM5MjA3ZTdlMmZfYWQ5MjY4NzU4ZDNlMTRkNDA0ZmY1NjI1ODM4Yzg4NjBfSUQ6NzQ0MjIyMTMxNzUwOTY3NzA4N18xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

一般是DNS服务器有缓存或故障导致的无法解析出要访问的域名。



**如何解决：**

- [修改DNS服务器](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#UULFdu)

- 联系公司IT统一修改DHCP，更改办公网出口DNS

- [DNS\_PROBE\_FINISHED\_NXDOMAIN](https://bytedance.us.feishu.cn/docx/doxusgEQ4pwKo48rpKk6VqjYvab) 



## ERR\_NAME\_NOT\_RESOLVED

**Chrome 浏览器报错：**

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MTM1ODUwMzdkYTI3YTMwYTg5ZjI3YTNlNDQ5NzNlNTFfOTNlNDRhYjA0ZmQ4NTc4ZTAyYjEzZGYwZDYwODhlMTZfSUQ6NzQ0MjIyMTMxMzIxNDgwODA5NV8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

问题原因同上



**如何解决：**

- [修改DNS服务器](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#UULFdu)

- 联系公司IT统一修改DHCP，更改办公网出口DNS



## ERR\_CONNECTION\_REFUSED

**Chrome 浏览器报错：**

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDcyOGM2NDEwYjY3MDI5YzNiOWIwNmQ5ODA1OTY0YjNfNDYwNTE0YjUzZTFiZDQ5YzY3ODMwMWM5NjEyYTMxNjdfSUQ6NzQ0MjIyMTMxNjkxMDA4ODIyNF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

**可能原因一：**

一般出现该问题是服务端端口没有监听，但是这种概率极小，大概率是域名被劫持到本地 `127.0.0.1 ` 或者 `0.0.0.0` ，出现这种问题一般是运营商的 LOCAL DNS 有故障。



可以验证一下自己访问域名的地址。（假设验证域名是  `abc.feishu.cn` ）

可自查一下是否是飞书的域名被劫持。

按照 [判断访问服务端IP](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#qYNpBm) 所示方法查看一下当前访问飞书的服务端地址是什么



如下图所示解析出来的ip为 `0.0.0.0` 或 `127.0.0.1` 即表示被劫持：

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDY5MDlhNjNhZWUzM2M0ZDU4NzA0NTFmYWY4MDE2Y2JfZGU4NThiNzFiM2UyNTViOGRlNjkyZmY2YWE2NjJlODRfSUQ6NzQ0MjIyMTMxMzYwNDg5NDc1Ml8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDVhNTNmMTQwOGRiN2EyOGQyN2VkNjJhYzA0MTI2NDJfYzRjYmUxNTdlZDhhZjM0OWJlYmY3ODFkZTFjNzhlM2VfSUQ6NzQ0MjIyMTMxMzIxNDg3MzYzMV8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



**解决手段：**

建议将自己设备的DNS服务器更改为 `223.5.5.5` 或者 `119.29.29.29` 具体可以参考

[修改DNS服务器](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#UULFdu)





**可能原因二：**

防火墙阻拦，一般防火墙对IP的进行的封禁有可能会导致出现上述问题



**解决手段：**

找IT排查一下是否有防火墙阻拦。







## ERR\_TUNNEL\_CONNECTION\_FAILED

**Chrome 浏览器报错：**

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MTBkODUwMmRhZjgwMDQxYjA3OWJkMDk0ODdmMWI5MjVfODMyOGY3YjZjZjEwNmFhM2JjOWVlNWU0NWFmYjRkYjhfSUQ6NzQ0MjIyMTMxMzYwNDg2MTk4NF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

一般是设备配置了代理，但是代理服务器出现了问题，没有正常转发业务请求



**如何解决：**

更改本机的代理服务器即可，可参考 [解决代理类问题导致的无法访问](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#yvTccP)





## ERR\_CERT\_COMMON\_NAME\_INVALID

**Chrome 浏览器报错：**

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=YjIyYTc4Yzc4ODdlOTc5Mzg2OTRkZWExODIxZTU5ZGVfMGI4N2U1Y2YyOTc4ODNmZjIwOTZmMjY2MzAzYzI1ZGNfSUQ6NzQ0MjIyMTMxMzIxNDg0MDg2M18xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

证书错误，一般飞书服务端不会出现此类问题。大概率是内网有防火墙、审计准入系统等导致。另外还有可能是一些病毒监听软件在中间人导致的问题。



可参考 [排查飞书服务的 SSL 证书情况](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#n29O85)

如果显示的各级证书不是如参考所示，说明有问题。



**如何解决：**

找IT解决，可能需要杀毒



## ERR\_ADDRESS\_UNREACHABLE

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MmJmYzYwZDlhZWViMmMyNmVlZDg4YjMyNzBiNWU0ZTFfNWY5N2MwMDMxMTY3YmUxY2U4MzRlMGY4YWVhYTVjNTdfSUQ6NzQ0MjIyMTMxMzYwNTAwOTQ0MF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

运营商劫持？或者本身所处的网络环境到飞书CDN的接入点之间有路由问题？需要排查接入的飞书节点是否正确。



**如何解决：**

这个问题需要先定位到底是什么原因才能针对问题进行解决。

- 排查接入节点是否正常

可以验证一下自己访问域名的地址的链路，可参考 [排查服务端IP路由路径 ](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#HKIWhB)

将截图保存，并发给飞书，以便查找问题。

- 换运营商（比如换手机热点接入）试试





## ERR\_CONNECTION\_TIMED\_OUT

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=OTk4ZjlhYzk0MjgzNzJmY2E5YzRjOWE3N2Y4YmQ2ZWZfOTJiMmZjMjQwMzhiNGQ3ZTZiMTJkZTM1OTU0ZmNhNjlfSUQ6NzQ0MjIyMTMxMzIxNDg1NzI0N18xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

自己的网络不佳有很大可能。有可能的原因  1\. 非三大运营商的跨网调度  2\. 防火墙拦截检查 

另外有可能是办公网配置有异常，比如将办公网出口配置到了香港等海外。

或者DNS服务器如果配置成 8\.8\.8\.8 有可能导致接入节点在海外从而访问体验很慢。



**如何解决：**

如果其他的网站都打开正常，仅飞书的域名报这个错误的话。

请访问 https://cip\.cc 网站截图（会显示你的出口IP），并在尝试检查 [访问服务端IP](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#qYNpBm) 、[服务端时延](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#rNk0ke) 



另外方便的话，最好按照文章末尾的 “[Wireshark 网络抓包](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#vwhrs4)” 进行操作并提供相关包内容。

如果是DNS服务配置错误的话，可以[参考建议修改DNS](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#UULFdu)



## ERR\_CONNECTION\_RESET

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MjNlYzEwN2NlOTA5NTg5ODZjMWRiODM5ZjM4NjNlZDhfOTJlYzg3Nzk1NDE1ZTdiNmVjOTRjMjkyNTQxMDM2OTZfSUQ6NzQ0MjIyMTMxMzYwNDkxMTEzNl8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**出现该问题原因：**

在访问过程中，连接被重置，有可能是防火墙有针对 TLS 的SNI 拦截，属于防火墙配置错误。也有比较小的概率是服务端的接入节点的问题，可以 [检查接入节点](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#qYNpBm)。



**如何解决：**

防火墙问题参考  [防火墙类问题解决](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#VFRfGc)

如果没有配置飞书的服务端域名白名单可以参考 [飞书域名白名单配置](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#pM6HEH)



## SSL\_ERROR\_DOWNGRADE\_WITH\_EARLY\_DATA

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=ZjFlZDkyOWY2ZjdmODRjYmY2ZTBiMTQ5MjE4NmVjYjJfYTZhZjkyMzIxODA2NDRmNWQ5N2U5ZjJmODVhOGQ5ODBfSUQ6NzQ0MjIyMTMxMzYwNDg3ODM2OF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**如何解决：**

可参考：[SSL\_ERROR\_DOWNGRADE\_WITH\_EARLY\_DATA](https://bytedance.us.feishu.cn/docx/doxus64FjDkwcIWs6V79iZJk6Zf) 



# 常见的网络问题解决

## 访问慢

可能导致慢的问题：

DNS配置错误、网络路由配置错误。



问题解决：

一般飞书的服务端采用动态加速的技术接入，简单的说，客户在哪里服务端解析出来的ip就位于客户所在地附近，如果DNS解析的地址与本地所在地理位置偏差太大则可能会导致体验访问慢。建议将DNS更改为 223\.5\.5\.5

- [修改DNS服务器](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#UULFdu)



## 访问不通

大概率是防火墙限制。

参考检查 [API连通性](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#CDg3IE)、如果不正常可以将 飞书的域名加入[白名单](https://bytedance.feishu.cn/docs/doccnZU4w2BUUpBwisyCzDFGUKh#pM6HEH)



# 如何提供更详细的网络排查日志

## 一\. Wireshark 网络抓包

Wireshark 是一款高效免费的抓包工具，wireshark可以捕获网络传输数据并描述网络数据包

- 网络管理员使用Wireshark检测网络问题

- 网安工程师用Wireshark检查信息安全相关问题

下载地址：https://www\.wireshark\.org/\#download

Windows 安装教程：https://blog\.51cto\.com/u\_5001660/2116582

Mac 安装教程：https://www\.xstnet\.com/article\-155\.html



- 先打开Wireshark ，选择网卡，并点击左上角的 “蓝色鲨鱼鳍” 开始抓包。

- 复现问题后点击“红色正方块”停止抓包。

- 点击“文件（第六个图标）”保存抓包内容到抓包文件

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NjFiZDRhYzYyZjA5ZDUwNjdmZGZiZTA4ZmFjYTQ3OWZfYTAzZDg4OWE0OTNlM2E3Mjc4OTQzMTczOGYwMzEyZGVfSUQ6NzQ0MjIyMTMxNjkxMDAzOTA3Ml8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



- 将抓包文件发送给问题排查人员



## 二\. Chromium netlog 

Chromium Netlog 开启方式

- 确定使用的是 chrome 浏览器

- 地址栏访问 `chrome://net-export/`

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MGE4NTRmMjFkNzczYjA3N2RkMDVhZjZhNDcyNzg0MWZfNjIzZDJlZjcwMDkzZTMxMTQxMGJmNWMyN2RkZDJiMDRfSUQ6NzQ0MjIyMTMxNjkxMDA1NTQ1Nl8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

    点击** Start Logging to Disk**, 选择一个合适的位置保存文件，

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MjUyMWNiZmY1MmQwNjg1NTZmYmNmNTdkNDY3ZjZjZDJfNTMwNDY4M2RkZDdkZjkxZGVmMjIzMzBmMmQ4ODU2YThfSUQ6NzQ0MjIyMTMxMzYwNDk3NjY3Ml8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

尝试复现问题，问题复现后，点击 **Stop Logging**，将文件私发问题排查同学。

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=M2E1MWNmYjBlNjZhNDRhNTU4YTY0MzY5ZWY1MzNhMWNfZDkyMTQzZjlkMmI1OTU5MTVkZmY4YjNjYTJjYTg3YmFfSUQ6NzQ0MjIyMTMxMzYwNDk2MDI4OF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



## 三\. 终端执行命令

一般一些操作系统检查命令需要打开电脑终端运行

**Mac 打开终端的方法：**

点击Mac右上角的 🔍 ，搜索 “终端” 或者 “Terminal” 

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=OWI0NGVkYmJhN2FkMDc5MzdmZGU1NjM1MWMyNzM4NWVfMWM3MTE0NWJlZGZiZjUzZDRkMDM3NjFhNzdjN2FiOTNfSUQ6NzQ0MjIyMTMxNjkxMDEyMDk5Ml8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

出现的如下应用即Mac 上的终端

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=YmJlM2FiNGJkOWI3MzU3YjIxODk1ZmQ0ZDUwZTMzNzVfZWI3ZTQ0NDRmMTIzMDU0MDNjZDJkMzY2OGIwZWE3OTRfSUQ6NzQ0MjIyMTMxNjkxMDEzNzM3Nl8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

**Windows 打开终端方法：**

所有的Windows的版本均可，同时按下键盘上的 “Win”\+“R” 组合键。

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MTNkZjljMmRhN2MzMWZkNjY5MTMwMTkyZWFiZmUzODJfYzdkMjU5ODA1NjNmMjJjMzNjYzM1MGE5OTdmNTQzNzlfSUQ6NzQ0MjIyMTMxMzYwNDc5NjQ0OF8xNzgxMDc2MjUyOjE3ODExNjI2NTJfVjM)



# 如何自查飞书服务连通性

## 一\. API 连通性

1. 浏览器访问几个飞书的域名，正常情况下会返回一堆 “\*” 

api3\-eeft\-gateway\.feishu\.cn/ies/speed

api3\-eeft\-imfile\.feishu\.cn/ies/speed

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=M2VhNGM2Y2RkMzk1ODNmYzdmMDAwMzE0NWNkNzMwMmFfZTQyZmI3NTc3ZmUyZjMzMzY2ZTIyMzZhZWNlZWIzMjFfSUQ6NzQ0MjIyMTMxMzYwNDk0MzkwNF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

如果网络正常会立即看到如上返回内容，如果不是则表示可能有网络上的连通性问题，可能是防火墙、准入软件、企业网出口配置导致。



## 二\. 判断访问服务端IP

- **Windows 下执行操作：**

打开终端

所有的Windows的版本均可，同时按下键盘上的 “Win”\+“R” 组合键。

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=OGNjY2RkZTAxNDQ5Y2EyODNjOTZmNGVlOTcxZjY2ZmZfZmExZmIzYWIyNTE5MDhkMjRkNzA2Y2IxNjFhMjNiZWNfSUQ6NzQ0MjIyMTMxMzIxNDc1ODk0M18xNzgxMDc2MjUyOjE3ODExNjI2NTJfVjM)

输入cmd，点击ok，在终端框中执行以下命令。

```Bash
nslookup abc.feishu.cn 
```

- **Mac 下执行操作：**

点击Mac右上角的 🔍 ，搜索 “终端” 或者 “Terminal” 

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDIzNzFkZTk1NmRkN2RmMjI0ZGIyYmYxNDZkYjc0ZjFfZjBlYzA4MGQyMzM3NjBjYjZmYWQ2NmE1MDc1OThjMGFfSUQ6NzQ0MjIyMTMxMjYxOTEwMjI0MF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

在终端中执行以下命令

```Bash
dig abc.feishu.cn
```



正常的话可以显示如下内容（不同地区运营商执行，可能IP不一样）

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDhkN2RlZjQzYjI1ZWEzNTViMDg0NDM4Y2I1Y2IxYWVfNjY5N2JiMzQ0YTA3NTM2NzhiMGZkZDQ4ZTExODU4MDVfSUQ6NzQ0MjIyMTMxNjkxMDE3MDE0NF8xNzgxMDc2MjUyOjE3ODExNjI2NTJfVjM)



## 三\. 排查飞书服务的SSL 证书情况

- 点击chrome浏览器 域名前的“小锁”

- 点击 “连接是安全的”（正常情况下是这么显示）

- 点击“证书有效”，可查看证书详细内容

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDEzYWNkYjM0NzgxYTAyOTU2ZTgzZDJkMWE3YWY3NTFfZTZmNzA3ZmM0ZDI1ZTBhY2ZmZWYwZWE5MzE2MWFkNzFfSUQ6NzQ0MjIyMTMxMzYwNDk5MzA1Nl8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=YzkyMjA3YjVhODgxYzU0ZjZmYzUzNDhmZDYwYzdmMTVfMDI2ZDBkNGEwODBkMjNjMTViY2RmMGMxODMzN2ZlYmFfSUQ6NzQ0MjIyMTMxMzIxNDg5MDAxNV8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



正常情况下，一级证书是 “**DigCert Clobal Root ****CA**”， 二级证书是 “Encryption Everywhere DV TLS CA \- G1” ， 三级证书是 "\*\.feishu\.cn"



## 四\. 排查访问服务端的 ip 路由路径

- **Windows：**

打开终端

所有的Windows的版本均可，同时按下键盘上的 “Win”\+“R” 组合键。

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NDkzNDMxY2QwZDY2ZDY5ZmY1M2M2YTVkMGFkY2I4OWVfMzMwYTdjM2NkYWQwYzk2ZTZkMjc1MjY5MDEyOWQwZDRfSUQ6NzQ0MjIyMTMxNjkxMDEwNDYwOF8xNzgxMDc2MjUyOjE3ODExNjI2NTJfVjM)

输入cmd，点击ok，在终端框中执行以下命令。

```Bash
**tracert  test.feishu.cn**
```

- Mac：

点击Mac左上角的 🔍 ，搜索 “终端” 或者 “Terminal” 

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MjQ3M2YyZjhiZmExNjhiNWE1YTZiYjk3NGQ2MjM2MGZfM2I3ZmVkMzllYTVlNzg2ZTRhNjg1N2VhZTZiYjU0NzhfSUQ6NzQ0MjIyMTMxMzIxNDgyNDQ3OV8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

在终端中执行以下命令

```Bash
traceroute test.feishu.cn
```





执行时间可能稍长，正常情况下会显示以下内容

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=NzdiMDQzNTY4OGVmOTVjYjE1YjVkMzdmOWUyNjVkMjFfYmU0ZTI0YmRlMzgwY2YyOTYyNmEwMjlkMmEwNzdlOTZfSUQ6NzQ0MjIyMTMxNjkxMDE1Mzc2MF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



## 五\. 检查到飞书服务端的时延

- **Windows 、Mac：**

Windows 和 Mac 方法通用，打开终端方法参考 二、四 里的方法即可。

终端下执行以下命令（假设租户的域名是 abc\.feishu\.cn）

```Bash
ping abc.feishu.cn
```

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MjBjNWVlYWEyNTRkMGFkNTM3ZGFhMTU1ZjRiMWUwZDVfNWM2N2U1Y2IyZTU3MGZjYzQ3MTU1NWI2YzRmYzI5MWFfSUQ6NzQ0MjIyMTMxNjkxMDA3MTg0MF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)





# 常见的问题解决手段

## 一\. 修改 DNS 服务器 

如果遇到域名解析类问题如 **DNS\_PROBE\_FINISHED\_NSDOMAIN** 或者 **ERR\_NAME\_NOT\_RESOLVED** 问题可以参考以下的的方案进行解决，通过以下修改方式可以校正访问飞书的服务端地址，另外一些访问慢、访问超时类的问题也可以参考该解决方案



建议将自己设备的DNS服务器更改为 `223.5.5.5` 或者 `119.29.29.29`

更改方式参考如下文档：

[【外部】DNS 解析自查帮助手册](https://bytedance.feishu.cn/docs/doccnMOTyXXsInQDeJs9VfNaoPd) 





## 二\. 添加飞书的域名白名单

参考下面的链接将飞书用到的域名加入防火墙白名单。

[https://www.feishu.cn/hc/zh-CN/articles/360044683233]()

> **飞书目前不提供 ****IP**** 白名单和单域名白名单 ，仅提供泛域名白名单，因为飞书的域名为满足全球客户的稳定接入有使用动态加速和****CDN****的技术，域名和IP都会随时间不断变化，因此****加白****名单的方式稳定性都不会很高，因此请谨慎采用白名单的方案。**
> 
> 





防火墙建议以泛域名的形式添加。

如果是3层防火墙，建议以黑名单的方式进行，其他ip的访问放行。

> 如有特殊需求或情况，可联系飞书CSM
> 
> 







## 三\. 解决代理类问题导致的无法访问

**Mac 端：**

- 在 Mac 上，选取苹果菜单   “系统偏好设置”，然后点按“网络”  

- 在列表中，选择您所使用的网络服务，例如“以太网”或 Wi\-Fi。

- 点按“高级”，然后点按“代理”。将右边的所有选项取消勾选。

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=ZjlkNzg0NDQ3NjE0NmVhZDFmYzEwMjU1M2YwOTc4ZTNfOWVjNTc4NTNkMTRlMGU5Yzc5MGNlNTc0MThlOTA5ZjJfSUQ6NzQ0MjIyMTMxMzYwNDkyNzUyMF8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)

https://support\.apple\.com/zh\-cn/guide/mac\-help/mchlp25912/mac



**Windows 端：**

- 打开设置

- 单击“网络和Internal”

- 单击代理

- 在“手动代理设置”部分中，将“使用代理服务器”开关设置为“关”

- 点击保存; 然后关闭设置窗口

![Image](https://internal-api-drive-stream-sg.larkoffice.com/space/api/box/stream/download/authcode/?code=MDRhYzI3ODEwYjk0NTJlYjFiMWUyNzFlY2Y3ZmEzZDNfOTBiODVjNTc5MTFhYzJjY2YyODAwYjYzNzU2MDg3NzlfSUQ6NzQ0MjIyMTMxMzIxNDkwNjM5OV8xNzgxMDc2MjUxOjE3ODExNjI2NTFfVjM)



## 四\. 防火墙类问题解决

防火墙问题自查文档参考如下

[飞书防火墙问题排查](https://bytedance.feishu.cn/docs/doccnjcqiclG8ZBMl5Nx0thtRzd) 















