// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 项目页服务在 /<repo>/ 子路径;用户页(<owner>.github.io)与本地为 /
const repo = process.env.GITHUB_REPOSITORY // owner/name
const repoName = repo?.split('/')[1]
const owner = repo?.split('/')[0]
const base =
  process.env.PAGES_BASE ?? (repoName && !repoName.endsWith('.github.io') ? `/${repoName}/` : '/')

export default defineConfig({
  output: 'static',
  base,
  site: owner ? `https://${owner.toLowerCase()}.github.io` : 'http://localhost:4321',
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
})
