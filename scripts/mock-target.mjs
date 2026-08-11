// 本地受控探测目标(docs/TEST.md §3):http :19080 + tcp :19090;:19099 保持无监听
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'

const routes = {
  '/ok': (res) => res.writeHead(200).end('ok — service-healthy'),
  '/slow': (res) => setTimeout(() => res.writeHead(200).end('slow but ok — service-healthy'), 4500),
  '/error500': (res) => res.writeHead(503).end('service unavailable'),
  '/nokeyword': (res) => res.writeHead(200).end('hello world'),
  '/hang': () => {}, // 挂起不响应,15s 后由客户端超时;连接由进程退出时回收
}

const http = createServer((req, res) => {
  res.on('error', () => {}) // 客户端中止(如 /hang 被超时 abort)产生的 RST 不应崩掉服务
  const handler = routes[req.url]
  if (handler) handler(res)
  else res.writeHead(404).end('not found')
})
http.on('connection', (socket) => socket.on('error', () => {}))
http.listen(19080, () => console.log('mock-target http on :19080 (/ok /slow /error500 /nokeyword /hang)'))

const tcp = createTcpServer((socket) => {
  socket.on('error', () => {})
  socket.end('hi\n')
})
tcp.listen(19090, () => console.log('mock-target tcp on :19090 (:19099 intentionally closed)'))
