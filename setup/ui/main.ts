/// <reference types="vite/client" />
import logo from '../../public/iwae-logo.png'

// Placeholder render; the real screens arrive with Task 8.
const app = document.getElementById('app')
if (app) {
  const img = document.createElement('img')
  img.className = 'logo'
  img.src = logo
  img.alt = ''
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = 'IWAE'
  app.append(img, name)
}
