import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'
import { App } from './App'

const root = createRoot(document.getElementById('root')!)
const render = (app: ReactNode) => root.render(<StrictMode>{app}</StrictMode>)

// A demo build has no backend: DemoFrame installs the in-page replay when it loads,
// before the first render (the demo e2e fails if a /v1 request reaches the network).
// Testing the literal MODE lets every other build drop the demo and its fixture.
if (import.meta.env.MODE === 'demo') {
  const { DemoFrame } = await import('./demo/DemoFrame.tsx')
  render(<DemoFrame><App /></DemoFrame>)
} else {
  render(<App />)
}
