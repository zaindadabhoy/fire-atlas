import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './index.css'
import './App.css'
import './landing.css'
import App from './App.tsx'

const Landing = lazy(() => import('./Landing.tsx'))

const isAtlas = () => window.location.hash.startsWith('#/atlas')

function Root() {
  const [atlas, setAtlas] = useState(isAtlas)
  useEffect(() => {
    const onHash = () => { setAtlas(isAtlas()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (atlas) return <App />
  return (
    <Suspense fallback={<div className="landing-loading"><span>⌖ FIRE ATLAS</span></div>}>
      <Landing onEnter={() => { window.location.hash = '#/atlas' }} />
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
