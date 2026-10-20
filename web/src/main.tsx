import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'

const root = createRoot(document.getElementById('root')!)
const render = (app: ReactNode) => root.render(<StrictMode>{app}</StrictMode>)

// A demo build has no backend. DemoFrame installs the in-page replay when it loads, so
// it loads before any of the app's modules. Testing the literal MODE lets every other
// build drop the demo and its fixture.
if (import.meta.env.MODE === 'demo') {
  const { DemoFrame } = await import('./demo/DemoFrame.tsx')
  const { App } = await import('./App')
  render(<DemoFrame><App /></DemoFrame>)
} else {
  const { App } = await import('./App')
  render(<App />)
}
