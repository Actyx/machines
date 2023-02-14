import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'

/**
 * Entry point for the web app, included from `index.html`
 */

const container = document.getElementById('app')
if (!container) throw new Error('div with ID `app` not found')
const root = createRoot(container)
root.render(<App />)
