import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import './index.css'
import { ConversationProvider } from '@elevenlabs/react'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConversationProvider>
      <App />
    </ConversationProvider>
  </StrictMode>,
)
