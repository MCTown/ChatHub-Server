// src/onebot-server.ts

import {OnebotServer} from "./OnebotServer";

const PORT = 6700;
// 每当有 Python 脚本连上来，就发送一个简单的握手响应
const server = new OnebotServer();

server.start(PORT);
