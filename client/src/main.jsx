import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import './index.css'
import './lib/pwa.js'
import App from './App.jsx'
import AuthProvider from './auth/AuthProvider.jsx'
import { ToastProvider } from './components/ui/toast.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Motion: only the features we use (m.* components, strict), and with
        "reduce motion" on, movement is skipped and only fades remain. */}
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
)
