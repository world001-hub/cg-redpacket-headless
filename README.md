# cg-redpacket-headless

红包接龙 headless 抢包方案的技能包。

- `SKILL.md` —— 完整方法论：架构、沙箱引导、网络层、TCP 协议、聊天室、判定逻辑、六大坑、实测数据、验收标准。
- `reference/engine.reference.js` —— 参考实现（CG红包接龙通用版 engine.js，27KB）的解构样本，用于对照 slot/单聊天室/串行队列/roomID 过滤的写法。
- `tools/tcpcli.cjs` —— 给 headless 引擎的 TCP 指令通道发命令并打印回包的小工具。

## 快速验证

```powershell
cd <参考实现目录>\engine
.\node.exe engine.js 9100 "<游戏链接>" 1
node tcpcli.cjs 9100 join 25000
```
