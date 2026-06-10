# 查看 net\-log 日志

## 导入 net\-log 日志

1. 访问：https://netlog\-viewer\.appspot\.com/\#import

2. 选中抓取的 chrome\-net\-export\-log\.json 文件

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=Y2FhNmJkNWFiMTNkNGM0NGFlYTExYzIyZTU5MmIxNmVfMmI1YWM1NGJiYzlhNmM3Y2I0MDYwZjFhNmRjZGNhOWVfSUQ6NzI1NzQzMjk2NDcxMTIzNTYxMl8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

3. 查看用户是否有使用代理

- Effective proxy settings

- Original proxy settings

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=NWQ3Y2IyOTA5ODQ2ZjY3NjkyNGViOGJhMWFiYTU1NTJfNmM4MzA2YzllNzllNjM2YTlhMGEyM2M4NDE2YmU5ZjFfSUQ6NzI2MDAxNTc0MDE3MzQxODQ5OF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

4. 选择 Events 选项，在输入框里输入type:url\_request，它代表只列出URL\_REQUEST类型的item
可以查看接口为“feishu\.cn”的爆红选项

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=ZGJmMDA3YTI4MzY5NGY1ZDY5MTJmODdkZTY1OTMzMzBfYjM3YzUyYTk4NzQ3ZmE4YzgxODA0YmYyZTI5ZjRmNzBfSUQ6NzI1NzQzNDA3MjM5Njg3MzczMl8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

请求 IP

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=MGMzMDg3MTBjMDdiODA5YjFkZjU3OGFmMGFlMjNhZWRfZWZjMDI0OWIwZjE5M2NmYmJkMDgxNjJkMzQ5OTg1OTJfSUQ6NzI1NzQzNjcwMjQzNTk4MzM4OF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

请求域名与方式

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=MjliMWUxYzFhMTgyMzM2MjY1ODgxZDU1MTdjOWJkYjZfNDcxOGQyZWNiZjQxZmQyMzBlODQzMWI0OWMwYzc0MmRfSUQ6NzI1NzQzNjczMTU1NzAwMzI2NV8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

5. 查看DNS：type:HOST\_RESOLVER\_IMPL\_JOB

本地域名解析失败，一般就是系统直接拒绝解析了

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=OWFhMGI0NGE3ODQ1YjVkZDA5MGRmNzIzODdiMWQ4NThfN2ZmZTI2NDQ2MWUyOGJlZjQ4MjhiNzhlMjc1MDAyN2FfSUQ6NzI1NzQzOTY5MTk4MDg0OTE1M18xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

DNS地址列表

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=ZWEyNzhiYTcwZTc2Yzg1ZTRjYjlmNTU2ZDVjNDc4Y2FfYTIwZDBmMzVmM2UyZGE4MWJjN2MwZDBjODIxMWVlOThfSUQ6NzI1NzQ0MDAzNTA0NDYwNTk1NF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

6. 查看活跃会话 ：type:HTTP2\_SESSION

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=MDNkZDUzYzRjMmI2MmNiMjZjN2Y3MmFhNTMyNjExYThfOGI5MWM5MDQwNzYwNDMzOGIzNDk2YjNlYjQ3NjI5YWJfSUQ6NzI1NzQ0MzcyNjI0MTg1NzU0MF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

7. Modules选项 https://netlog\-viewer\.appspot\.com/\#modules ， 查看用户Chrome浏览器上的扩展

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=NmMzZThiMTIwNTAwOGRhM2Y4MjdmYjJmYTk5ZDU5ODdfY2I2ZGI2ODc1Y2NjYTllYjhiMjA5NDlhMjA1MzBiOWNfSUQ6NzI1NzQ0NDE4ODgxMDU3NTg3M18xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)



**Tips**：左上角对应的选项中有对应的：View live sockets 按钮点击后可生成对应搜索语句

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=MDQ5ZmNmZmJkYzFiMDYwN2VkNjAxMzFlMDkyODQ0ZDJfOWFjZDBhNDViYzRmMGFmN2IyNGNlNjBhMTczNjE4YWRfSUQ6NzI1NzQ0NzMwMjQxNDQwMTUzN18xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

8. 观察TCP\_CONNECT时常，SSL\_CONNECT时长，SSL\_CONNECT完成时长，如下图，TCP\_CONNECT很快，SSL\_CONNECT的连接时长为63\-27 = 36ms，属于正常时长，但是SOCKET\_IN\_USE的时长偏长，

    - 有两种原因：

        - 录日志前没刷缓存，导致数量累积

        - 该域名下的请求很多，但是如果请求时间都正常的话，也属于正常现象

        - 的确是每个请求都花了比较多的时间

    具体是什么原因，需要转入request查看具体数据

    type:socket is:active

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=YTVkNmZhZTBjNDJmZGE2NzEzMGZlYWI3ZTdkOTE5OTRfYTQwN2U5MmI3YmM0ZTc3NzVmOGE3Njk4OWY0MmE5ODlfSUQ6NzI2MDAxNjgzMDg0NzQxODM2OV8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=ZDNkYmM4ZDJkNGRkNzk5OGY1NDcxODhiM2FmYTc3M2VfYTZmZGE5YTgwZDI4YWZmMjYyMmVjZDhhYjgyNDBjYjlfSUQ6NzI2MDAxNjgyOTYwMjQxNDU5Nl8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

9. 查看request数据，定位当前域名，查看CORS\_REQUEST的时长，1s左右就属于时间偏长，

以下面的数据为case，该域名下的请求大部分时间都在1s\-6s之间，说明该链路存在问题，如果这个CORS\_REQUEST都比较短，那之前的SOCKET\_ALIVE时长就可能是缓存引起的，接下来要查找到底是哪部分导致CORS\_REQUEST耗费了时长

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=MTA4YWE3YTM0NjA1MGNiM2RkY2Q4OWZjYjE3YjI5OGFfMDFjNDFiNDAzNzVmODE3ZTFmYzE3N2FkNmQ5M2FhYTBfSUQ6NzI2MDAxNjgzMTIxNjM4NjA1MF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

通过request的详细数据，可以发现HTTP\_TRANSACTION\_READ\_BODY到HTTP2\_STREAM\_UPDATE\_RECV\_WINDOW的时长突然激增分成两个方面

- HTTP\_TRANSACTION\_READ\_HEADERS 到 HTTP\_TRANSACTION\_READ\_RESPONSE\_HEADERS的时长，该数据表示web端接收到server回包的时长，这个数据和链路有关

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=ZTRmNTFiYzJkNGY2N2Q2ZDZmMTRiYjljYjQzMThkMjJfNWM1MWEyODU4ODBiODUxZTMwYTRiNDE3ZGNkODk2YzlfSUQ6NzI2MDAxNjgzMTE1MzcwMDg5Ml8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)

HTTP\_TRANSACTION\_READ\_BODY到 HTTP2\_STREAM\_UPDATE\_RECV\_WINDOW的时长，该时长为数据传输的时长，该时长跟数据包的大小，网速有关

![Image](https://api3-eeft-drive.larkoffice.com/space/api/box/stream/download/authcode/?code=OTJlNTIyMTA3OThkNzBlMmRiNGRhYWQ3NzkzYzY0OTNfY2MwZTQ0YmQ2OTkyNjkxNDU1NmI1MTYxNzlmYTdmMzFfSUQ6NzI2MDAxNjgyOTYwMjQzMDk4MF8xNzgwOTEyMjM5OjE3ODA5OTg2MzlfVjM)



