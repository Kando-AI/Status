// 本地 webhook 捕获端(docs/TEST.md §3):打印收到的 POST 载荷
import { createServer } from 'node:http'

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    console.log(`--- ${new Date().toISOString()} ${req.method} ${req.url}`)
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2))
    } catch {
      console.log(body)
    }
    res.writeHead(200).end('ok')
  })
}).listen(19081, () => console.log('mock-webhook on :19081'))
