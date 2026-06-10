# 【外部】DNS 解析自查帮助手册

针对由于客户网络环境，打开飞书文档慢或打不开的问题，提供 dns 自查帮助手册

# 常见问题\&解决方案

## 打不开文档

出现如下图中的问题时，是访问 xxx\.feishu\.cn 域名时，dns 解析失败

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NjNhYjkwZjliZjBhN2NmNWRlMTA2MjFmZTQ4OTZmMjdfMjhmYzVjZWQwNmE2MDYyYzFkZjQ5ZDBlMGU1NDE0MjBfSUQ6NzQyOTY2MzAxOTI2MzY1NTkzOF8xNzgxMDc2MjkxOjE3ODExNjI2OTFfVjM)

**问题原因**：

排查发现通常是由于公共 DNS（移动联通电信默认） 114\.114\.114\.114 不稳定导致



**解决方案**：

[如何修改dns](https://bytedance.feishu.cn/docs/doccnMOTyXXsInQDeJs9VfNaoPd#6ahWFA)



## 打开文档慢

现象：打开文档时，加载时间长，从 network 上看到是静态资源加载慢

**问题原因**：

部分场景下发现存在国内静态资源域名 sf3\-scmcdn2\-cn\.feishucdn\.com 解析到了香港，导致请求和返回速度很慢



**解决方案**：

[如何修改dns](https://bytedance.feishu.cn/docs/doccnMOTyXXsInQDeJs9VfNaoPd#6ahWFA)



# 操作指南

## 如何打开命令行

**windows：**

- 打开“开始菜单”，搜索“命令提示符”

- 百度经验：https://jingyan\.baidu\.com/article/af9f5a2d4dae9643140a4586\.html

**mac：**

- 「Command \+ 空格」，然后在输入框里输入“终端”

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=NTk1NjZkN2UyMmQyYTIzNDgyZDFkNDEyZGE3M2Y3NTVfNzUxZjBkY2IzZDFiMjY5YjU1ZmYxODdjYTlkYWFiN2JfSUQ6NzQyOTY2MzAxODMxNTgwODc2OV8xNzgxMDc2MjkxOjE3ODExNjI2OTFfVjM)



## 如何修改 dns

若客户出现跨网情况，需让客户的IT调整，确保获取到的节点与桌面公网出口是同一运营商。

关于DNS选择：

**首选推荐使用出口运营商分配的localdns**，可以请客户自行联系带宽出口运营商提供，若客户不确定，可以参考以下DNS大全：

https://dnsdaquan\.com/

其次是国内云厂商的公共DNS

- 国内公共dns：

国内运营商公共DNS：[114\.114\.114\.114](http://114.114.114.114/)（移动联通电信共用的，负责的公司已经不再维护了，不稳定！）

阿里云：[223\.5\.5\.5](http://223.5.5.5/)  [223\.6\.6\.6](http://223.6.6.6/) （推荐👍）

腾讯云：[119\.29\.29\.29](http://119.29.29.29/) 

百度云：[180\.76\.76\.76](http://180.76.76.76/)

在国内访问海外 larksuite 时，推荐修改 dns 为阿里云的 223\.5\.5\.5

（云厂商的公共DNS一般都是BGP接入，支持多种运营商环境）

- 海外目前无测试环境，没有针对海外推荐的DNS解析。东南亚推荐的常用dns：[Common Free DNS for APAC](https://bytedance.sg.feishu.cn/sheets/shtlge0gUmbm6u0k5DUocDLdZzg) 

修改操作流程如下：

**windows：**

1. 打开控制面板，在“开始”旁边的搜索框搜索“控制面板”

2. 然后参考 [如何设置阿里公共DNS（223\.5\.5\.5/223\.6\.6\.6）](https://jingyan.baidu.com/article/fec7a1e515dd4d1190b4e78f.html)

**windows10：**

参考 [Windows 10 设置 DNS](https://zhuanlan.zhihu.com/p/641207795)

**windows11：**

[Win11系统如何手动配置DNS?Win11系统设置DNS方法\-攀升知识库](https://knowledge.ipason.com/ipKnowledge/knowledgedetail.html/1851)
上面链接如果失效可见该文档：[Win11系统如何手动配置DNS？Win11系统设置DNS方法](https://bytedance.larkoffice.com/docx/DDa3dj5Fdol8SFxq6guc2Kv7nlb)

**mac：**

参考 [MAC电脑手动设置DNS](https://jingyan.baidu.com/article/6525d4b1887abaac7d2e94ec.html)



修改完成后记得清除 dns 缓存



## 如何清除 dns 缓存

更换DNS地址后，客户可以使用下列命令，甚至重连网络或电脑，来强制刷新本地的 DNS 解析，并重新尝试打开飞书文档

- \(chrome\) 访问 chrome://net\-internals/\#dns ，并点击 「clear host cache」 按钮

- \(windows\) 打开命令行（操作流程见上方「如何打开命令行」），输入  ipconfig /flushdns

- \(mac\) 打开命令行，输入  sudo killall \-HUP mDNSResponder



# 如何选择合适的 dns

- 如果是在大陆境内，可以用：

    - 阿里 AliDNS 223\.5\.5\.5 和 223\.6\.6\.6【推荐】

    - 移动电信联通通用的公共 DNS 114\.114\.114\.114 【不推荐】（许多用户默认就是该DNS，但由于该运营公司停止维护，质量有下降，解析不够稳定），且在访问海外 larksuite 时非常不稳定

    - 实际哪个好需要客户实测比较一下

- 如果是在香港或海外，首选谷歌的DNS 8\.8\.8\.8

- **如果在国内用谷歌的****DNS****，或在海外用国内的DNS，****就****会极不稳定**



# 自查指南

## 查看本地某域名的 dns 解析结果

打开命令行，在命令行下运行 \(windows\) nslookup 或 \(mac\) dig 指令，可以查看域名解析的结果

- 以下以 xxx\.feishu\.cn 为例，这里的域名可以修改为任何怀疑访问有问题的域名

    - 比如说 sf3\-ccm1\-cn\.feishucdn\.com 或者 xxxx\.larksuite\.com

- 输入 nslookup xxx\.feishu\.cn  ，可以查看默认情况下的解析结果

    - ping xxx\.feishu\.cn ，可以查看请求该域名的响应和连通性

- 输入 nslookup xxx\.feishu\.cn 223\.5\.5\.5 ，可以查看指定首选DNS的解析结果

- 以上是 windows 的场景，相应的，使用 mac 可以输入 dig xxx\.feishu\.cn 



## 查看浏览器 devtool 中请求的 ip 是否正确

打开浏览器 devtool，查看 「Network」或「网络」

如图，113\.96\.109\.93 就是 bytedance\.feishu\.cn 这个域名解析到的 ip

![Image](https://internal-api-drive-stream.larkoffice.com/space/api/box/stream/download/authcode/?code=MzkzNTVlYWU0YmZlYTI3Y2I4MzAwZjFmNDIyNTdhODhfY2U3YjFlNDA3MGY5NjVlYWJhN2ZlODgwZDVmZDYzNjBfSUQ6NzQyOTY2MzAxODMxNTc5MjM4NV8xNzgxMDc2MjkxOjE3ODExNjI2OTFfVjM)

和命令行 nslookup 查询出来的 ip 结果进行对比，看是否相同

如果不相同，可能存在 ipv6 访问不稳定或者某个环节的 dns 劫持，导致实际浏览器访问到的 ip 不正确



