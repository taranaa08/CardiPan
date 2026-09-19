import { useConversation, useConversationClientTool } from '@elevenlabs/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { voiceTools, type LogMeal } from '../voice'

type Props = {
  logMeal: LogMeal
  onError: (e: unknown) => void
}

const MicIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="7" y="2.5" width="6" height="10" rx="3" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" strokeLinecap="round" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
    <rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
)

/** Mic button in the tab bar. Hidden unless the API reports ElevenLabs credentials. */
export function VoiceButton({ logMeal, onError }: Props) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    api.voiceStatus().then((s) => setEnabled(s.enabled), () => setEnabled(false))
  }, [])

  // Registered with the provider; the SDK always calls the latest closure.
  const tools = voiceTools(logMeal)
  useConversationClientTool('get_budget', tools.get_budget)
  useConversationClientTool('get_meal_options', tools.get_meal_options)
  useConversationClientTool('log_meal', tools.log_meal)

  const conversation = useConversation({
    onError: (message: unknown) => onError(new Error(`Voice: ${String(message)}`)),
  })
  const live = conversation.status === 'connected' || conversation.status === 'connecting'

  async function start() {
    try {
      // Ask for the mic up front so a denial gets a clear message; the SDK opens its own stream.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      const { signed_url } = await api.voiceSession()
      conversation.startSession({ signedUrl: signed_url, connectionType: 'websocket' })
    } catch (e) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError'
      onError(denied ? new Error('Microphone access is blocked. Allow it in your browser to talk to the app.') : e)
    }
  }

  if (!enabled) return null

  return (
    <button
      type="button"
      className={live ? 'voice-btn voice-btn--live' : 'voice-btn'}
      aria-pressed={live}
      aria-label={live ? 'End voice conversation' : 'Talk to the app'}
      title={live ? 'End conversation' : 'Talk'}
      onClick={live ? () => conversation.endSession() : start}
    >
      {live ? <StopIcon /> : <MicIcon />}
    </button>
  )
}
