import React, { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, MousePointer2, Pause, Play, RotateCcw, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react'

const MAX_MESSAGE_LENGTH = 1000
const DEMO_STEP_COUNT = 12
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*/gu

function getWordRanges(text) {
  return Array.from(text.matchAll(WORD_PATTERN), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function isPotentialMaleVoiceName(voice) {
  return /\b(male|david|guy|mark|daniel|ravi|rishi|arjun)\b/i.test(voice.name)
}

function Icon({ name, size = 18 }) {
  const paths = {
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>,
    translate: <><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1" /><path d="M14 21l5-11 5 11M16 17h6" /></>,
    voice: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" /></>,
    info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4m0-4h.01" /></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    play: <path d="m8 5 12 7-12 7V5Z" />,
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

async function postJson(path, body, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`)
  return data
}

function App() {
  const [message, setMessage] = useState('')
  const [result, setResult] = useState(null)
  const [translation, setTranslation] = useState('')
  const [explanation, setExplanation] = useState([])
  const [explanationMethod, setExplanationMethod] = useState('')
  const [error, setError] = useState('')
  const [translationError, setTranslationError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [metrics, setMetrics] = useState([])
  const [health, setHealth] = useState('checking')
  const [speech, setSpeech] = useState('idle')
  const [speechNotice, setSpeechNotice] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('ready')
  const [voiceDraft, setVoiceDraft] = useState('')
  const [speechInputNotice, setSpeechInputNotice] = useState('')
  const [voices, setVoices] = useState([])
  const [activeSpeech, setActiveSpeech] = useState(null)
  const [copied, setCopied] = useState(false)
  const [demoStatus, setDemoStatus] = useState('idle')
  const [demoFailed, setDemoFailed] = useState(false)
  const [demoStepIndex, setDemoStepIndex] = useState(-1)
  const [demoSubtitle, setDemoSubtitle] = useState('')
  const [demoFocus, setDemoFocus] = useState('')
  const [demoSpotlightPosition, setDemoSpotlightPosition] = useState(null)
  const [demoVoiceIndex, setDemoVoiceIndex] = useState('auto')
  const [demoVoiceNotice, setDemoVoiceNotice] = useState('')
  const speechSequence = useRef(0)
  const boundaryTimer = useRef(null)
  const wordElements = useRef(new Map())
  const recognitionRef = useRef(null)
  const voiceSessionRef = useRef(null)
  const voiceRequestIdRef = useRef(0)
  const speechCompletionRef = useRef(null)
  const demoRunId = useRef(0)
  const demoSkipRequested = useRef(false)
  const demoStatusRef = useRef('idle')
  const demoAbortController = useRef(null)
  const demoSnapshot = useRef(null)
  const translationRequestId = useRef(0)
  const explanationState = useRef({ explanation: [], method: '' })
  const demoTranslation = useRef('')

  const setDemoPlaybackStatus = (status) => {
    demoStatusRef.current = status
    setDemoStatus(status)
  }

  const finishSpeechWaiter = (completed = false) => {
    const complete = speechCompletionRef.current
    speechCompletionRef.current = null
    complete?.(completed)
  }

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((response) => {
        if (!response.ok) throw new Error('Backend unavailable')
        return response.json()
      })
      .then((data) => {
        setHealth(data.model_loaded ? 'online' : 'offline')
        setMetrics(data.metrics || [])
      })
      .catch(() => setHealth('offline'))
  }, [])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined
    const synthesis = window.speechSynthesis
    const refreshVoices = () => {
      const availableVoices = synthesis.getVoices()
      setVoices(availableVoices)
    }
    refreshVoices()
    const supportsVoiceEvents = typeof synthesis.addEventListener === 'function'
    if (supportsVoiceEvents) synthesis.addEventListener('voiceschanged', refreshVoices)
    else synthesis.onvoiceschanged = refreshVoices
    window.addEventListener('focus', refreshVoices)
    document.addEventListener('visibilitychange', refreshVoices)
    const retryTimers = [100, 500, 1500].map((delay) => window.setTimeout(refreshVoices, delay))
    return () => {
      if (supportsVoiceEvents) synthesis.removeEventListener('voiceschanged', refreshVoices)
      else if (synthesis.onvoiceschanged === refreshVoices) synthesis.onvoiceschanged = null
      window.removeEventListener('focus', refreshVoices)
      document.removeEventListener('visibilitychange', refreshVoices)
      retryTimers.forEach(window.clearTimeout)
      if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current)
      voiceRequestIdRef.current += 1
      voiceSessionRef.current = null
      recognitionRef.current?.abort()
      recognitionRef.current = null
      speechSequence.current += 1
      synthesis.cancel()
      finishSpeechWaiter(false)
    }
  }, [])

  const stopSpeech = () => {
    speechSequence.current += 1
    if (boundaryTimer.current) {
      window.clearTimeout(boundaryTimer.current)
      boundaryTimer.current = null
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    finishSpeechWaiter(false)
    setSpeech('idle')
    setActiveSpeech(null)
  }

  const speak = async (text, lang, target, preferredVoice = null) => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setSpeechNotice('Speech playback is not supported in this browser.')
      finishSpeechWaiter(false)
      return
    }
    const synthesis = window.speechSynthesis
    const availableVoices = synthesis.getVoices()
    setVoices(availableVoices)
    let voice = preferredVoice || (lang === 'hi'
      ? availableVoices.find((item) => item.lang.toLowerCase().replace('_', '-').startsWith('hi'))
      : availableVoices.find((item) => item.lang.toLowerCase().replace('_', '-').startsWith('en-us'))
        || availableVoices.find((item) => item.lang.toLowerCase().replace('_', '-').startsWith('en')))

    if (lang === 'hi' && !voice) {
      setSpeechNotice('Checking for an available Hindi speech voice…')
      for (let attempt = 0; attempt < 10 && !voice; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100))
        const refreshedVoices = synthesis.getVoices()
        setVoices(refreshedVoices)
        voice = refreshedVoices.find((item) => item.lang.toLowerCase().replace('_', '-').startsWith('hi'))
      }
    }

    const sequence = speechSequence.current + 1
    speechSequence.current = sequence
    if (boundaryTimer.current) {
      window.clearTimeout(boundaryTimer.current)
      boundaryTimer.current = null
    }
    synthesis.cancel()
    setSpeechNotice(lang === 'hi' && !voice
      ? 'Hindi voice is not listed by the browser. Trying the installed device voice with hi-IN.'
      : lang === 'en' && !voice
        ? 'No English voice was found. Trying the browser default voice.'
        : '')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang === 'hi' ? 'hi-IN' : (voice?.lang || 'en-US')
    if (voice) utterance.voice = voice
    let hasWordBoundaries = false
    const wordRanges = getWordRanges(text)

    setSpeech('speaking')
    setActiveSpeech({ target, text, lang, wordIndex: -1, boundarySupported: null })
    utterance.onstart = () => {
      if (speechSequence.current !== sequence) return
      setSpeech('speaking')
      setSpeechNotice('')
      boundaryTimer.current = window.setTimeout(() => {
        if (speechSequence.current === sequence && !hasWordBoundaries) {
          setActiveSpeech((current) => current?.target === target ? { ...current, wordIndex: -1, boundarySupported: false } : current)
          setSpeechNotice('This browser voice does not expose reliable word-boundary events, so synchronized word highlighting is unavailable for this playback.')
        }
      }, 1800)
    }
    utterance.onboundary = (event) => {
      if (speechSequence.current !== sequence || event.name === 'sentence' || !Number.isFinite(event.charIndex)) return
      const wordIndex = wordRanges.findIndex((word) => event.charIndex >= word.start && event.charIndex < word.end)
      if (wordIndex < 0) return
      hasWordBoundaries = true
      if (boundaryTimer.current) {
        window.clearTimeout(boundaryTimer.current)
        boundaryTimer.current = null
      }
      setSpeechNotice('')
      setActiveSpeech({ target, text, lang, wordIndex, boundarySupported: true })
      const activeElement = wordElements.current.get(`${target}-${wordRanges[wordIndex].start}`)
      activeElement?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
    utterance.onend = () => {
      if (speechSequence.current !== sequence) return
      if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current)
      boundaryTimer.current = null
      setSpeech('idle')
      setActiveSpeech(null)
      if (!hasWordBoundaries) {
        setSpeechNotice('Speech completed, but this browser voice did not provide word-boundary events. Synchronized highlighting is unavailable for this voice.')
      }
      finishSpeechWaiter(true)
    }
    utterance.onerror = (event) => {
      if (speechSequence.current !== sequence) return
      if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current)
      boundaryTimer.current = null
      setSpeech('idle')
      setActiveSpeech(null)
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setSpeechNotice(`Speech playback failed${event.error ? ` (${event.error})` : ''}. Check the selected voice and browser settings.`)
      }
      finishSpeechWaiter(false)
    }
    try {
      synthesis.speak(utterance)
    } catch (playbackError) {
      speechSequence.current += 1
      if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current)
      boundaryTimer.current = null
      setSpeech('idle')
      setActiveSpeech(null)
      setSpeechNotice(`Speech playback could not start${playbackError instanceof Error ? `: ${playbackError.message}` : '.'}`)
      finishSpeechWaiter(false)
      return
    }
    return true
  }

  const speakAndWait = async (text, lang = 'en', target = 'demo', preferredVoice = null) => {
    const playbackEnded = new Promise((resolve) => {
      speechCompletionRef.current = resolve
    })
    const started = await speak(text, lang, target, preferredVoice)
    if (!started) return false
    return playbackEnded
  }

  const renderSpeechText = (text, target, placeholder) => {
    if (!text) return placeholder
    const ranges = getWordRanges(text)
    const isActive = activeSpeech?.target === target && activeSpeech.text === text
    let cursor = 0
    return ranges.map((word, index) => {
      const before = text.slice(cursor, word.start)
      cursor = word.end
      const active = isActive && activeSpeech.wordIndex === index
      return (
        <span key={`${word.start}-${word.end}`}>
          {before}
          <span
            className={`karaoke-word${active ? ` active active-color-${index % 6}` : ''}`}
            ref={(element) => {
              const key = `${target}-${word.start}`
              if (element) wordElements.current.set(key, element)
              else wordElements.current.delete(key)
            }}
          >{word.text}</span>
        </span>
      )
    }).concat(cursor < text.length ? [text.slice(cursor)] : [])
  }

  const speakerPlaybackClass = (target) => {
    if (activeSpeech?.target !== target) return ''
    if (speech === 'speaking') return ' speaking'
    if (speech === 'paused') return ' paused'
    return ''
  }

  const stopVoiceInput = () => {
    const recognition = recognitionRef.current
    if (!recognition) {
      voiceRequestIdRef.current += 1
      setIsListening(false)
      setVoiceStatus('ready')
      setVoiceDraft('')
      return
    }

    if (voiceSessionRef.current) voiceSessionRef.current.stopRequested = true
    setVoiceStatus('processing')
    setSpeechInputNotice('Finishing voice input…')
    try {
      recognition.stop()
    } catch (stopError) {
      recognition.abort()
      setSpeechInputNotice(stopError instanceof Error ? stopError.message : 'Voice input stopped unexpectedly.')
    }
  }

  const startVoiceInput = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceStatus('error')
      setSpeechInputNotice('Voice typing is not supported in this browser. Try a current version of Chrome or Edge.')
      return
    }

    if (recognitionRef.current) {
      stopVoiceInput()
      return
    }
    if (voiceStatus === 'processing') return

    const requestId = voiceRequestIdRef.current + 1
    voiceRequestIdRef.current = requestId
    setVoiceStatus('processing')
    setSpeechInputNotice('Requesting microphone access…')

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch (permissionError) {
      if (voiceRequestIdRef.current !== requestId) return
      setVoiceStatus('error')
      const permissionMessage = permissionError instanceof DOMException && permissionError.name === 'NotFoundError'
        ? 'No microphone was found. Connect or enable a microphone and try again.'
        : permissionError instanceof DOMException && permissionError.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow microphone permission in your browser, then try again.'
          : permissionError instanceof Error
            ? `Could not access the microphone: ${permissionError.message}`
            : 'Could not access the microphone. Check your browser permission and try again.'
      setSpeechInputNotice(permissionMessage)
      return
    }
    if (voiceRequestIdRef.current !== requestId) return

    setSpeechInputNotice('')
    setVoiceDraft('')
    const recognition = new SpeechRecognition()
    const session = {
      recognition,
      baseMessage: message.trim(),
      finalTranscript: '',
      stopRequested: false,
      error: false,
    }
    voiceSessionRef.current = session
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 3
    recognition.onstart = () => {
      if (voiceSessionRef.current !== session) return
      setIsListening(true)
      setVoiceStatus('listening')
      setSpeechInputNotice('Listening… speak naturally in English.')
    }
    recognition.onresult = (event) => {
      if (voiceSessionRef.current !== session) return
      const interimParts = []
      const firstChangedResult = Number.isInteger(event.resultIndex) ? event.resultIndex : 0
      for (let index = firstChangedResult; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript?.trim()
        if (!transcript) continue
        if (event.results[index].isFinal) {
          session.finalTranscript = [session.finalTranscript, transcript].filter(Boolean).join(' ')
        }
        else interimParts.push(transcript)
      }
      if (session.finalTranscript) {
        const nextMessage = [session.baseMessage, session.finalTranscript].filter(Boolean).join(' ').slice(0, MAX_MESSAGE_LENGTH)
        setMessage(nextMessage)
      }
      setVoiceDraft(interimParts.join(' ').trim())
    }
    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'Microphone access was denied. Allow microphone permission in your browser, then try again.',
        'permission-denied': 'Microphone access was denied. Allow microphone permission in your browser, then try again.',
        'service-not-allowed': 'Speech recognition is not allowed by this browser or device.',
        'no-speech': 'No speech was detected. Check your microphone and try speaking again.',
        'audio-capture': 'No microphone was found. Connect or enable a microphone and try again.',
        network: 'The browser speech-recognition service could not be reached. Check your connection and try again.',
      }
      session.error = event.error !== 'aborted'
      setVoiceStatus('error')
      if (event.error !== 'aborted') {
        setSpeechInputNotice(messages[event.error] || `Voice typing failed (${event.error}). Check microphone and browser settings.`)
      }
      setIsListening(false)
    }
    recognition.onend = () => {
      if (voiceSessionRef.current !== session) return
      if (recognitionRef.current === recognition) recognitionRef.current = null
      voiceSessionRef.current = null
      setIsListening(false)
      setVoiceDraft('')
      if (!session.error) {
        setVoiceStatus('ready')
        setSpeechInputNotice(
          session.finalTranscript
            ? 'Voice input captured. You can now analyze or translate the message.'
            : 'No speech was captured. Check your microphone and try again.',
        )
      }
    }
    try {
      recognition.start()
    } catch (recognitionError) {
      voiceSessionRef.current = null
      recognitionRef.current = null
      setIsListening(false)
      setVoiceStatus('error')
      setSpeechInputNotice(recognitionError instanceof Error ? recognitionError.message : 'Could not start voice typing. Check microphone permission and try again.')
    }
  }

  const analyzeMessage = async (event, { signal, messageOverride } = {}) => {
    event?.preventDefault()
    const text = (messageOverride ?? message).trim()
    if (!text) {
      setError('Please enter a message to analyze.')
      return
    }
    setError('')
    setTranslationError('')
    setResult(null)
    setTranslation('')
    setExplanation([])
    setIsAnalyzing(true)
    explanationState.current = { explanation: [], method: '' }
    try {
      const prediction = await postJson('/api/predict', { message: text }, signal)
      setResult(prediction)
      try {
        const details = await postJson('/api/explain', { message: text, prediction: prediction.prediction }, signal)
        setExplanation(details.explanation)
        setExplanationMethod(details.method)
        explanationState.current = { explanation: details.explanation, method: details.method }
      } catch (requestError) {
        if (signal?.aborted) return null
        setExplanation([requestError.message])
        setExplanationMethod('unavailable')
        explanationState.current = { explanation: [requestError.message], method: 'unavailable' }
      }
      return prediction
    } catch (requestError) {
      if (signal?.aborted) return null
      setError(requestError.message || 'Unable to reach the ScamShield backend.')
      return null
    } finally {
      setIsAnalyzing(false)
    }
  }

  const translateMessage = async ({ signal, messageOverride } = {}) => {
    const text = (messageOverride ?? message).trim()
    if (!text) {
      setTranslationError('Enter an English message before translating.')
      return
    }
    const requestId = translationRequestId.current + 1
    translationRequestId.current = requestId
    setIsTranslating(true)
    setTranslationError('')
    try {
      const data = await postJson('/api/translate', { message: text }, signal)
      if (signal?.aborted || translationRequestId.current !== requestId) return null
      setTranslation(data.translation)
      return data
    } catch (requestError) {
      if (signal?.aborted) return null
      setTranslationError(requestError.message || 'Translation is currently unavailable.')
      return null
    } finally {
      if (translationRequestId.current === requestId) {
        translationRequestId.current += 1
        setIsTranslating(false)
      }
    }
  }

  const getDemoVoice = () => {
    const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('en'))
    if (demoVoiceIndex !== 'auto') return voices[Number(demoVoiceIndex)] || null
    const possibleIndianMaleVoice = englishVoices.find((voice) => (
      voice.lang.toLowerCase().replace('_', '-').startsWith('en-in')
      && isPotentialMaleVoiceName(voice)
    ))
    const possibleMaleVoice = englishVoices.find(isPotentialMaleVoiceName)
    return possibleIndianMaleVoice
      || possibleMaleVoice
      || englishVoices.find((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('en-in'))
      || englishVoices[0]
      || null
  }

  const waitForDemo = async (duration, runId) => {
    const endTime = Date.now() + duration
    while (true) {
      if (demoRunId.current !== runId) return false
      if (demoSkipRequested.current) return true
      if (demoStatusRef.current === 'paused') {
        await new Promise((resolve) => window.setTimeout(resolve, 80))
        continue
      }
      const remaining = endTime - Date.now()
      if (remaining <= 0) return true
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(24, remaining)))
    }
  }

  const waitForDemoResume = async (runId) => {
    while (demoRunId.current === runId && demoStatusRef.current === 'paused') {
      await new Promise((resolve) => window.setTimeout(resolve, 80))
    }
    return demoRunId.current === runId
  }

  const typeDemoMessage = async (text, runId) => {
    setMessage('')
    for (let index = 0; index < text.length; index += 1) {
      if (demoRunId.current !== runId || demoSkipRequested.current) return false
      if (!await waitForDemoResume(runId)) return false
      setMessage(text.slice(0, index + 1))
      if (!await waitForDemo(42, runId)) return false
    }
    return true
  }

  const setDemoSpotlight = (targetId) => {
    setDemoFocus(targetId)
  }

  const focusDemoTarget = async (targetId, runId) => {
    const target = document.getElementById(targetId)
    if (!target) throw new Error(`The demo target "${targetId}" is not available.`)
    if (demoRunId.current !== runId || demoSkipRequested.current) return false
    target.scrollIntoView({ behavior: 'instant', block: 'center' })
    let rect = target.getBoundingClientRect()
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      window.scrollTo({
        top: Math.max(0, window.scrollY + rect.top - (window.innerHeight - rect.height) / 2),
        behavior: 'instant',
      })
      rect = target.getBoundingClientRect()
    }
    const left = rect.left + rect.width / 2 - 17
    const top = rect.top + rect.height / 2 - 17
    setDemoSpotlight(targetId)
    setDemoSpotlightPosition({
      left: Math.min(window.innerWidth - 34, Math.max(0, left)),
      top: Math.min(window.innerHeight - 34, Math.max(0, top)),
    })
    return true
  }

  const restoreDemoSnapshot = () => {
    const snapshot = demoSnapshot.current
    if (!snapshot) return
    setMessage(snapshot.message)
    setResult(snapshot.result)
    setTranslation(snapshot.translation)
    setExplanation(snapshot.explanation)
    setExplanationMethod(snapshot.explanationMethod)
    setError(snapshot.error)
    setTranslationError(snapshot.translationError)
  }

  const startDemo = (restart = false) => {
    if (!speechSupported) {
      setSpeechNotice('Automatic narration is not supported in this browser. Try a current version of Chrome or Edge.')
      return
    }
    demoAbortController.current?.abort()
    stopSpeech()
    if (!restart || !demoSnapshot.current) {
      demoSnapshot.current = {
        message,
        result,
        translation,
        explanation,
        explanationMethod,
        error,
        translationError,
      }
    } else {
      restoreDemoSnapshot()
    }
    const runId = demoRunId.current + 1
    demoRunId.current = runId
    demoSkipRequested.current = false
    demoAbortController.current = null
    setDemoStepIndex(-1)
    setDemoSubtitle('')
    setDemoSpotlight('')
    setDemoFailed(false)
    setDemoPlaybackStatus('running')
    setSpeechNotice('')

    const scamMessage = 'Congratulations! You have won a ₹50,000 reward. Click this link to claim your prize now.'
    const safeMessage = 'Hi, are we still meeting at the library after class today?'
    const demoVoice = getDemoVoice()
    const possibleMaleFound = Boolean(demoVoice && isPotentialMaleVoiceName(demoVoice))
    const voiceNote = demoVoice
      ? `Narration voice: ${demoVoice.name} (${demoVoice.lang}). Browser voice names do not verify gender; choose a voice you recognize as male in the voice selector if needed.`
      : 'No English voice is listed yet. The browser default may be used; its gender cannot be verified. Choose an available voice in the selector if one appears.'
    setDemoVoiceNotice(possibleMaleFound
      ? `${voiceNote} A name-based possible male voice was selected; voice names cannot confirm gender.`
      : `${voiceNote} No clearly identifiable male voice is available by name. An alternative English voice is offered, not represented as male.`)

    const steps = [
      {
        focus: 'demo-dashboard',
        narration: 'Hello everyone, welcome to ScamShield AI 2.0. This is the dashboard. Here you can check a message, translate it into Hindi, and listen to it.',
      },
      {
        focus: 'sms-message',
        narration: 'This is the message box. Type or paste an English message here. I will now enter a sample scam message.',
        action: async () => {
          setResult(null)
          setTranslation('')
          setExplanation([])
          setExplanationMethod('')
          explanationState.current = { explanation: [], method: '' }
          setError('')
          setTranslationError('')
          const finishedTyping = await typeDemoMessage(scamMessage, runId)
          if (!finishedTyping && demoRunId.current === runId && demoSkipRequested.current) {
            setMessage(scamMessage)
          }
          return finishedTyping
        },
      },
      {
        focus: 'dictation-button',
        narration: 'You can also press this Speak button and say your message. The words will appear in the message box. This demo will not turn on your microphone.',
      },
      {
        focus: 'analyze-button',
        narration: 'Now I am moving to Analyze message. I will check the sample after this explanation.',
        action: async (signal) => {
          const prediction = await analyzeMessage(undefined, { signal, messageOverride: scamMessage })
          if (!prediction) throw new Error('Scam prediction did not return a result. Check the Flask backend and try the demo again.')
          return prediction
        },
        resultFocus: 'prediction-result',
        resultNarration: (prediction) => `The result for this sample is ${prediction.prediction === 'SCAM' ? 'potential scam' : 'likely legitimate'}${typeof prediction.confidence === 'number' ? `, with ${prediction.confidence.toFixed(2)} percent confidence` : ''}.`,
      },
      {
        focus: 'translate-button',
        narration: 'Now I am moving to Translate to Hindi. I will translate the same message after this explanation.',
        action: async (signal) => {
          const translated = await translateMessage({ signal, messageOverride: scamMessage })
          if (!translated) throw new Error('Hindi translation did not return. Check the translation model, network access for its first download, and the backend.')
          demoTranslation.current = translated.translation
          return translated
        },
        resultFocus: 'hindi-message-text',
        resultNarration: () => 'The Hindi translation appears here beside the original. A Transformer reads the English text and generates the Hindi translation using attention.',
      },
      {
        focus: 'english-speaker-button',
        narration: 'This speaker reads the original English message aloud. Listen to the example.',
        after: async () => {
          if (demoRunId.current !== runId || demoSkipRequested.current) return
          if (!await waitForDemoResume(runId) || demoSkipRequested.current) return
          return speakAndWait(scamMessage, 'en', 'english', demoVoice)
        },
      },
      {
        focus: 'hindi-speaker-button',
        narration: 'This speaker reads the Hindi translation aloud. I will try the installed Hindi voice now.',
        after: async () => {
          if (demoRunId.current !== runId || demoSkipRequested.current || !demoTranslation.current) return
          const hindiVoice = voices.find((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('hi'))
          if (hindiVoice) {
            if (!await waitForDemoResume(runId) || demoSkipRequested.current) return
            return speakAndWait(demoTranslation.current, 'hi', 'hindi', hindiVoice)
          }
          if (!await waitForDemoResume(runId) || demoSkipRequested.current) return
          return speakAndWait(demoTranslation.current, 'hi', 'hindi')
        },
      },
      {
        focus: 'english-stop-button',
        narration: 'The square Stop button beside the English speaker immediately stops English playback.',
      },
      {
        focus: 'hindi-stop-button',
        narration: 'The square Stop button beside the Hindi speaker immediately stops Hindi playback.',
      },
      {
        focus: 'sms-message',
        narration: 'Now I am entering an ordinary meeting message so we can check another example.',
        action: async (signal) => {
          setResult(null)
          setTranslation('')
          setExplanation([])
          setExplanationMethod('')
          explanationState.current = { explanation: [], method: '' }
          setError('')
          const finishedTyping = await typeDemoMessage(safeMessage, runId)
          if (!finishedTyping && demoRunId.current === runId && demoSkipRequested.current) {
            setMessage(safeMessage)
          }
          if (demoRunId.current !== runId || demoSkipRequested.current) return null
          const prediction = await analyzeMessage(undefined, { signal, messageOverride: safeMessage })
          if (!prediction) throw new Error('The legitimate-example prediction did not return. Check the local Flask backend.')
          return prediction
        },
        resultFocus: 'prediction-result',
        resultNarration: (prediction) => `The result for this message is ${prediction.prediction === 'SCAM' ? 'potential scam' : 'likely legitimate'}${typeof prediction.confidence === 'number' ? `, with ${prediction.confidence.toFixed(2)} percent confidence` : ''}.`,
      },
      {
        focus: 'explanation',
        narration: 'This section shows a short explanation of the message result, based on the text that was checked.',
      },
      {
        focus: 'demo-dashboard',
        narration: 'That is the ScamShield dashboard demonstration. Thank you for watching.',
      },
    ]

    const run = async () => {
      try {
        for (let index = 0; index < steps.length; index += 1) {
          if (demoRunId.current !== runId) return
          if (!await waitForDemoResume(runId)) return
          if (demoSkipRequested.current) demoSkipRequested.current = false
          const step = steps[index]
          setDemoStepIndex(index)
          if (!await focusDemoTarget(step.focus, runId)) {
            if (demoRunId.current !== runId) return
            if (demoSkipRequested.current) {
              demoSkipRequested.current = false
              continue
            }
          }
          const narration = typeof step.narration === 'function' ? step.narration() : step.narration
          setDemoSubtitle(narration)
          let actionResult
          const stepController = step.action ? new AbortController() : null
          if (stepController) demoAbortController.current = stepController
          try {
            if (!await waitForDemoResume(runId)) return
            if (demoSkipRequested.current) {
              demoSkipRequested.current = false
              continue
            }
            const narrationCompleted = await speakAndWait(narration, 'en', 'demo', demoVoice)
            if (!narrationCompleted) {
              if (demoRunId.current !== runId) return
              if (demoSkipRequested.current) {
                demoSkipRequested.current = false
                continue
              }
              throw new Error('Narration could not complete. The demo is paused to keep the cursor and actions synchronized.')
            }
            if (demoRunId.current !== runId) return
            if (!await waitForDemoResume(runId)) return
            if (demoSkipRequested.current) {
              demoSkipRequested.current = false
              continue
            }
            if (step.action) {
              actionResult = await step.action(stepController.signal)
              if (demoRunId.current !== runId) return
              if (stepController.signal.aborted || demoSkipRequested.current) {
                demoSkipRequested.current = false
                continue
              }
              if (actionResult == null) throw new Error('The requested demo action did not complete. Check the backend and try again.')
              if (!await waitForDemoResume(runId)) return
            }
            if (step.resultNarration) {
              if (step.resultFocus && !await focusDemoTarget(step.resultFocus, runId)) {
                if (demoRunId.current !== runId) return
                if (demoSkipRequested.current) {
                  demoSkipRequested.current = false
                  continue
                }
              }
              const resultText = step.resultNarration(actionResult)
              setDemoSubtitle(resultText)
              if (!await waitForDemoResume(runId)) return
              if (demoSkipRequested.current) {
                demoSkipRequested.current = false
                continue
              }
              if (!await speakAndWait(resultText, 'en', 'demo', demoVoice)) {
                if (demoRunId.current !== runId) return
                if (demoSkipRequested.current) {
                  demoSkipRequested.current = false
                  continue
                }
                throw new Error('Narration could not complete. The demo is paused to keep the cursor and actions synchronized.')
              }
            }
            if (step.after && demoRunId.current === runId && !demoSkipRequested.current) {
              const afterCompleted = await step.after()
              if (afterCompleted === false && demoRunId.current === runId && !demoSkipRequested.current) {
                throw new Error('Speech playback could not complete. The demo is paused to keep the cursor and actions synchronized.')
              }
            }
            if (demoRunId.current !== runId) return
            if (!await waitForDemoResume(runId)) return
            if (demoSkipRequested.current) demoSkipRequested.current = false
          } catch (stepError) {
            if (stepController?.signal.aborted && demoRunId.current === runId && demoSkipRequested.current) {
              demoSkipRequested.current = false
              continue
            }
            throw stepError
          } finally {
            if (demoAbortController.current === stepController) demoAbortController.current = null
          }
        }
        if (demoRunId.current === runId) {
          setDemoStepIndex(steps.length - 1)
          setDemoSubtitle('Thank you for watching the ScamShield AI 2.0 demonstration.')
          setDemoSpotlight('')
          setDemoPlaybackStatus('completed')
        }
      } catch (demoError) {
        if (demoRunId.current !== runId) return
        demoAbortController.current?.abort()
        demoAbortController.current = null
        stopSpeech()
        setDemoSubtitle(demoError instanceof Error ? demoError.message : 'The demonstration could not complete.')
        setSpeechNotice('The guided demo is paused because narration or an API action failed. Check the browser voice and backend, then restart the demo.')
        setDemoFailed(true)
        setDemoPlaybackStatus('paused')
      }
    }
    void run()
  }

  const pauseDemo = () => {
    if (demoStatusRef.current !== 'running') return
    window.speechSynthesis?.pause()
    setDemoPlaybackStatus('paused')
  }

  const resumeDemo = () => {
    if (demoStatusRef.current !== 'paused' || demoFailed) return
    window.speechSynthesis?.resume()
    setDemoPlaybackStatus('running')
  }

  const skipDemoStep = () => {
    if (demoStatusRef.current !== 'running' && demoStatusRef.current !== 'paused') return
    demoSkipRequested.current = true
    demoAbortController.current?.abort()
    demoAbortController.current = null
    window.speechSynthesis?.resume()
    setDemoPlaybackStatus('running')
    stopSpeech()
  }

  const stopDemo = () => {
    demoRunId.current += 1
    demoAbortController.current?.abort()
    demoAbortController.current = null
    demoSkipRequested.current = false
    stopSpeech()
    restoreDemoSnapshot()
    demoSnapshot.current = null
    setDemoStepIndex(-1)
    setDemoSubtitle('')
    setDemoSpotlight('')
    setDemoFailed(false)
    setDemoPlaybackStatus('idle')
    setDemoVoiceNotice('')
  }

  const clearAll = () => {
    stopSpeech()
    recognitionRef.current?.abort()
    recognitionRef.current = null
    setIsListening(false)
    setVoiceDraft('')
    setMessage('')
    setResult(null)
    setTranslation('')
    setExplanation([])
    setError('')
    setTranslationError('')
    setSpeechInputNotice('')
  }

  const clearTranslation = () => {
    setTranslation('')
    setTranslationError('')
    setCopied(false)
  }

  const copyTranslation = async () => {
    try {
      await navigator.clipboard.writeText(translation)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setTranslationError('Clipboard access is unavailable. Select and copy the Hindi text manually.')
    }
  }

  const isScam = result?.prediction === 'SCAM'
  const bestMetric = metrics.find((item) => item.model === 'Linear SVM')
  const accuracy = bestMetric ? `${(bestMetric.accuracy * 100).toFixed(2)}%` : '—'
  const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const demoActive = demoStatus === 'running' || demoStatus === 'paused'
  const englishVoices = voices
    .map((voice, index) => ({ voice, index }))
    .filter(({ voice }) => voice.lang.toLowerCase().replace('_', '-').startsWith('en'))
  useEffect(() => {
    if (!demoActive || !demoFocus) {
      setDemoSpotlightPosition(null)
      return undefined
    }
    const updatePosition = () => {
      const target = document.getElementById(demoFocus)
      if (!target) return
      const rect = target.getBoundingClientRect()
      const hotspotX = rect.left + rect.width / 2
      const hotspotY = rect.top + rect.height / 2
      setDemoSpotlightPosition({
        left: Math.min(window.innerWidth - 34, Math.max(0, hotspotX - 17)),
        top: Math.min(window.innerHeight - 34, Math.max(0, hotspotY - 17)),
      })
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [demoActive, demoFocus, demoStepIndex])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="ScamShield dashboard">
          <span className="brand-icon"><Icon name="shield" size={22} /></span>
          <span>ScamShield <b>AI</b><small>INTELLIGENCE SUITE</small></span>
        </a>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <a className="nav-link active" href="#dashboard"><Icon name="scan" /> Dashboard</a>
          <a className="nav-link" href="#detection"><Icon name="shield" /> Scam detection</a>
          <a className="nav-link" href="#translation"><Icon name="translate" /> Translator</a>
          <a className="nav-link" href="#voice"><Volume2 size={18} /> Voice assistant</a>
          <a className="nav-link" href="#explanation"><Icon name="spark" /> AI explanation</a>
          <a className="nav-link" href="#about"><Icon name="info" /> About project</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="model-status"><span className={`status-dot ${health}`} /><span><b>{health === 'online' ? 'Model online' : health === 'checking' ? 'Connecting...' : 'Backend offline'}</b><small>Local prediction service</small></span></div>
          <p>For awareness and education. Always verify unexpected requests independently.</p>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className={`topbar${demoStatus !== 'idle' ? ' demo-topbar-active' : ''}`}>
          <div className="breadcrumb">Workspace <span>/</span> Dashboard</div>
          <div className="topbar-actions">
            <div className="topbar-status"><span className={`status-dot ${health}`} /> {health === 'online' ? 'All systems operational' : health === 'checking' ? 'Connecting to backend' : 'Backend unavailable'}</div>
            {demoStatus === 'idle' ? <div className="demo-idle-tools">
              <select className="demo-toolbar-voice" aria-label="Select demo narration voice" title="Select the narration voice before starting the demo" value={demoVoiceIndex} onChange={(event) => setDemoVoiceIndex(event.target.value)}>
                <option value="auto">Auto voice (prefers Indian English)</option>
                {englishVoices.map(({ voice, index }) => <option value={String(index)} key={`${voice.voiceURI || voice.name}-${voice.lang}-${index}`}>{voice.name} ({voice.lang}){isPotentialMaleVoiceName(voice) ? ' — possible male-sounding name; verify' : ''}</option>)}
              </select>
              <button className="auto-demo-button" type="button" onClick={() => startDemo(false)}><Play size={14} fill="currentColor" /> Auto Demo</button>
            </div> : <div className="demo-toolbar" aria-label="Automatic demonstration controls">
              <span className="demo-toolbar-status"><i className={`demo-live-dot${demoStatus === 'paused' ? ' paused' : ''}`} />{demoStatus === 'running' ? `STEP ${Math.max(1, demoStepIndex + 1)}/${DEMO_STEP_COUNT}` : demoStatus === 'paused' ? 'PAUSED' : 'COMPLETE'}</span>
              <select className="demo-toolbar-voice" aria-label="Narration voice" value={demoVoiceIndex} onChange={(event) => setDemoVoiceIndex(event.target.value)} disabled={demoActive}>
                <option value="auto">Auto voice (prefers Indian English)</option>
                {englishVoices.map(({ voice, index }) => <option value={String(index)} key={`${voice.voiceURI || voice.name}-${voice.lang}-${index}`}>{voice.name} ({voice.lang}){isPotentialMaleVoiceName(voice) ? ' — possible male-sounding name; verify' : ''}</option>)}
              </select>
              <div className="demo-toolbar-controls">
                {demoStatus === 'completed' ? <button type="button" onClick={() => startDemo(false)} aria-label="Play demo again" title="Play demo again"><RotateCcw size={15} /></button> : <button type="button" onClick={pauseDemo} disabled={demoStatus !== 'running'} aria-label="Pause demo" title="Pause demo"><Pause size={15} /></button>}
                <button type="button" onClick={resumeDemo} disabled={demoStatus !== 'paused' || demoFailed} aria-label="Resume demo" title={demoFailed ? 'Restart the demo after the error' : 'Resume demo'}><Play size={15} fill="currentColor" /></button>
                <button type="button" onClick={() => startDemo(true)} aria-label="Restart demo" title="Restart demo"><RotateCcw size={15} /></button>
                <button type="button" onClick={skipDemoStep} disabled={!demoActive || demoFailed} aria-label="Skip demo step" title="Skip demo step"><SkipForward size={15} /></button>
                <button type="button" onClick={stopDemo} aria-label={demoStatus === 'completed' ? 'Close demo and restore previous message' : 'Stop demo and restore previous message'} title={demoStatus === 'completed' ? 'Close demo' : 'Stop demo'}>{demoStatus === 'completed' ? <X size={15} /> : <Square size={14} fill="currentColor" />}</button>
              </div>
            </div>}
          </div>
        </header>
        {demoStatus !== 'idle' && <div className="demo-caption" aria-label="Live demonstration subtitles">
          <div className="demo-caption-heading"><strong>{demoStatus === 'completed' ? 'DEMO COMPLETE' : demoStatus === 'paused' ? 'DEMO PAUSED' : 'LIVE DEMONSTRATION'}</strong><span>Step {Math.max(1, demoStepIndex + 1)} of {DEMO_STEP_COUNT}</span></div>
          <div className="demo-progress-track" role="progressbar" aria-label="Demonstration progress" aria-valuemin="0" aria-valuemax={DEMO_STEP_COUNT} aria-valuenow={Math.max(0, demoStepIndex + 1)}><span style={{ width: `${Math.max(0, (demoStepIndex + 1) / DEMO_STEP_COUNT) * 100}%` }} /></div>
          <p className="demo-subtitle" key={demoSubtitle} role="status" aria-live="polite">{demoSubtitle || 'Preparing the guided demonstration…'}</p>
          <p className="demo-voice-disclaimer">Browser voices do not expose verified gender. Choose and confirm a voice you prefer using the voice selector.</p>
        </div>}

        <section className={`welcome${demoFocus === 'demo-dashboard' ? ' demo-target' : ''}`} id="demo-dashboard">
          <div>
            <p className="eyebrow">CYBERSECURITY • LANGUAGE • VOICE</p>
            <h1>ScamShield AI <span>2.0</span></h1>
            <p className="welcome-subtitle">AI-Powered Scam Detection, English-to-Hindi Translation &amp; Voice Assistance</p>
            <p className="welcome-copy">One intelligent workspace to analyze suspicious messages, understand them in Hindi, and listen with your device's voice engine.</p>
          </div>
          <div className="welcome-emblem"><div className="emblem-ring"><Icon name="shield" size={48} /></div><span className="orbit orbit-one" /><span className="orbit orbit-two" /></div>
        </section>

        <section className="stat-grid" aria-label="Project status">
          <article className="stat-card"><span className="stat-icon blue"><Icon name="scan" /></span><div><span className="stat-title">Detection engine</span><strong>Linear SVM</strong><small>Trained ML pipeline</small></div><span className="stat-check"><Icon name="check" size={15} /></span></article>
          <article className="stat-card"><span className="stat-icon purple"><Icon name="translate" /></span><div><span className="stat-title">Translation</span><strong>English → हिन्दी</strong><small>Helsinki OPUS-MT</small></div><span className="stat-tag">ON-DEMAND</span></article>
          <article className="stat-card"><span className="stat-icon cyan"><Icon name="shield" /></span><div><span className="stat-title">Test accuracy</span><strong>{accuracy}</strong><small>Held-out test set</small></div><span className="stat-tag">REPORTED</span></article>
        </section>

        <section className="workflow-strip" aria-label="Workflow">
          <span className="workflow-label">YOUR WORKFLOW</span>
          <div><i>01</i> Analyze <span>→</span></div><div><i>02</i> Translate <span>→</span></div><div><i>03</i> Listen <span>→</span></div><div><i>04</i> Understand</div>
        </section>

        <section className="workspace-grid">
          <article className={`panel input-panel${demoFocus === 'detection' ? ' demo-target' : ''}`} id="detection">
            <div className="panel-heading">
              <div className="heading-icon"><Icon name="scan" /></div>
              <div><p className="section-kicker">SCAM DETECTION</p><h2>Inspect a message</h2></div>
              <span className={`service-badge ${health}`}>{health === 'online' ? '● READY' : '● OFFLINE'}</span>
            </div>
            <form onSubmit={analyzeMessage}>
              <div className="message-input-label">
                <label htmlFor="sms-message">English SMS or message</label>
                <div className="dictation-controls">
                  <span className={`voice-state-pill ${voiceStatus}`}>{voiceStatus === 'ready' ? 'Ready' : voiceStatus === 'listening' ? 'Listening' : voiceStatus === 'processing' ? 'Processing' : 'Error'}</span>
                  <button id="dictation-button" className={`dictation-button${isListening ? ' listening' : ''}${voiceStatus === 'error' ? ' error' : ''}${demoFocus === 'dictation-button' ? ' demo-target' : ''}`} type="button" onClick={startVoiceInput} aria-label={isListening ? 'Stop voice typing' : 'Start voice typing'} title={isListening ? 'Stop voice typing' : 'Speak in English to fill the message'} disabled={demoActive}>{isListening ? <MicOff size={16} /> : <Mic size={16} />}{isListening ? 'Stop listening' : voiceStatus === 'processing' ? 'Processing...' : 'Speak'}</button>
                </div>
              </div>
              <textarea id="sms-message" className={demoFocus === 'sms-message' ? 'demo-target' : ''} value={message} onChange={(event) => { if (activeSpeech) stopSpeech(); setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH)) }} placeholder="Paste a message you want to check, or use Speak to dictate..." maxLength={MAX_MESSAGE_LENGTH} disabled={isAnalyzing || isTranslating || isListening || demoActive} />
              {isListening && <p className="dictation-status" role="status"><span /> Listening in English… {voiceDraft && <em>{voiceDraft}</em>}</p>}
              {speechInputNotice && <p className="dictation-notice" role="status">{speechInputNotice}</p>}
              <div className="input-meta"><span>Processed by your local Flask API</span><span>{message.length}/{MAX_MESSAGE_LENGTH}</span></div>
              {error && <div className="inline-error" role="alert">{error}</div>}
              <div className="button-row">
                <button id="analyze-button" className={`button-primary${demoFocus === 'analyze-button' ? ' demo-target' : ''}`} type="submit" disabled={isAnalyzing || health === 'offline' || demoActive}>{isAnalyzing ? <><span className="spinner" /> Analyzing...</> : <><Icon name="scan" /> Detect Scam</>}</button>
                <button className="button-quiet" type="button" onClick={clearAll} disabled={(!message && !result) || demoActive}>Clear</button>
              </div>
            </form>
            {result && <div id="prediction-result" className={`prediction-result ${isScam ? 'scam' : 'safe'}${demoFocus === 'prediction-result' ? ' demo-target' : ''}`} role="status">
              <div className="prediction-symbol">{isScam ? '!' : <Icon name="check" size={24} />}</div>
              <div className="prediction-copy"><span>{isScam ? 'SUSPICIOUS MESSAGE' : 'LIKELY LEGITIMATE'}</span><h3>{isScam ? 'Potential scam detected' : 'Message appears safe'}</h3><p>{isScam ? 'Treat unexpected requests with caution and verify independently.' : 'No guarantee of safety. Verify the sender and context.'}</p></div>
              {typeof result.confidence === 'number' && <div className="confidence"><strong>{result.confidence.toFixed(2)}%</strong><small>model confidence</small></div>}
            </div>}
          </article>

          <article className={`panel translation-panel${demoFocus === 'translation' ? ' demo-target' : ''}`} id="translation">
            <div className="panel-heading">
              <div className="heading-icon purple-icon"><Icon name="translate" /></div>
              <div><p className="section-kicker">NEURAL TRANSLATION</p><h2>English to Hindi</h2></div>
              <span className="language-pair">EN <span>→</span> HI</span>
            </div>
            <div className="translation-content">
              <div className="message-box"><div className="message-label"><span>ENGLISH MESSAGE</span><div className="speaker-actions"><button id="english-speaker-button" type="button" className={`speaker-button${speakerPlaybackClass('english')}${demoFocus === 'english-speaker-button' ? ' demo-target' : ''}`} aria-label="Speak English message" title={speechSupported ? 'Read English message aloud' : 'Speech playback is not supported'} disabled={!message.trim() || demoActive} onClick={() => speak(message.trim(), 'en', 'english')}>{speechSupported ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><button id="english-stop-button" type="button" className={`speaker-stop-button${demoFocus === 'english-stop-button' ? ' demo-target' : ''}`} aria-label="Stop English speech" title="Stop English speech" disabled={activeSpeech?.target !== 'english' || speech === 'idle' || demoActive} onClick={stopSpeech}><Icon name="stop" size={15} /></button></div></div><p>{renderSpeechText(message.trim(), 'english', 'Your English message will appear here.')}</p></div>
              <div className="message-box hindi-box"><div className="message-label"><span>हिंदी अनुवाद</span><div className="speaker-actions"><button id="hindi-speaker-button" type="button" className={`speaker-button${speakerPlaybackClass('hindi')}${!speechSupported ? ' unavailable' : ''}${demoFocus === 'hindi-speaker-button' ? ' demo-target' : ''}`} aria-label={speechSupported ? 'Speak Hindi translation' : 'Hindi speech playback is not supported'} title={speechSupported ? 'Read Hindi translation aloud with the installed hi-IN voice' : 'Speech playback is not supported'} disabled={!translation || demoActive} onClick={() => speak(translation, 'hi', 'hindi')}>{speechSupported ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><button id="hindi-stop-button" type="button" className={`speaker-stop-button${demoFocus === 'hindi-stop-button' ? ' demo-target' : ''}`} aria-label="Stop Hindi speech" title="Stop Hindi speech" disabled={activeSpeech?.target !== 'hindi' || speech === 'idle' || demoActive} onClick={stopSpeech}><Icon name="stop" size={15} /></button></div></div><p id="hindi-message-text" className={demoFocus === 'hindi-message-text' ? 'demo-target' : ''} lang="hi">{renderSpeechText(translation, 'hindi', 'आपका हिंदी अनुवाद यहाँ दिखाई देगा।')}</p></div>
              {translationError && <div className="inline-error" role="alert">{translationError}</div>}
              <div className="translation-actions">
                <button id="translate-button" className={`button-primary translate-button${demoFocus === 'translate-button' ? ' demo-target' : ''}`} type="button" onClick={translateMessage} disabled={isTranslating || demoActive}>{isTranslating ? <><span className="spinner" /> Translating...</> : <><Icon name="translate" /> Translate to Hindi</>}</button>
                <button className="button-quiet copy-button" type="button" onClick={copyTranslation} disabled={!translation || demoActive}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy'}</button>
                <button className="button-quiet" type="button" onClick={clearTranslation} disabled={!translation && !translationError || demoActive}>Clear text</button>
              </div>
            </div>
          </article>
        </section>

        <section className="lower-grid">
          <article className={`panel voice-panel${demoFocus === 'voice' ? ' demo-target' : ''}`} id="voice">
            <div className="panel-heading compact-heading"><div className="heading-icon cyan-icon"><Volume2 size={18} /></div><div><p className="section-kicker">VOICE ASSISTANT</p><h2>Listen to messages</h2></div></div>
            <p className="panel-description">Speech is generated by your browser and installed system voices. Hindi playback requires a Hindi voice on your device.</p>
            <div className="voice-controls">
              <button type="button" onClick={() => { window.speechSynthesis?.pause(); setSpeech('paused') }} disabled={!speechSupported || speech !== 'speaking' || demoActive} aria-label="Pause speech"><Icon name="pause" /></button>
              <button type="button" onClick={() => { window.speechSynthesis?.resume(); setSpeech('speaking') }} disabled={!speechSupported || speech !== 'paused' || demoActive} aria-label="Resume speech"><Icon name="play" /></button>
              <button type="button" onClick={stopSpeech} disabled={!speechSupported || speech === 'idle' || demoActive} aria-label="Stop speech"><Icon name="stop" /></button>
              <span className={`speech-state ${speech}`}><i /> {speech === 'speaking' ? 'Speaking now' : speech === 'paused' ? 'Paused' : 'Ready to play'}</span>
            </div>
            {(demoVoiceNotice || speechNotice) && <p className="voice-notice" role="status">{demoVoiceNotice || speechNotice}</p>}
          </article>
          <article className={`panel explanation-panel${demoFocus === 'explanation' ? ' demo-target' : ''}`} id="explanation">
            <div className="panel-heading compact-heading"><div className="heading-icon amber-icon"><Icon name="spark" /></div><div><p className="section-kicker">AI EXPLANATION</p><h2>Why was it flagged?</h2></div><span className="method-tag">{explanationMethod || 'RULE-BASED'}</span></div>
            {explanation.length ? <ul className="explanation-list">{explanation.map((item, index) => <li key={`${index}-${item}`} lang={item.match(/[\u0900-\u097F]/) ? 'hi' : 'en'}>{item}</li>)}</ul> : <p className="panel-description">Analyze a message to see a transparent explanation. The fallback explanation checks for directly observable text cues and does not claim to be a generative model.</p>}
          </article>
        </section>

        <section className={`about-section${demoFocus === 'about' ? ' demo-target' : ''}`} id="about">
          <div className="about-heading"><div><p className="section-kicker">ABOUT THE PROJECT</p><h2>Machine learning, responsibly applied.</h2></div><p>ScamShield combines a trained text classifier with on-demand neural translation and browser-native accessibility tools.</p></div>
          <div className="about-cards">
            <article><span className="about-number">01</span><h3>Existing ML model</h3><p>Pre-trained TF-IDF + calibrated Linear SVM pipeline classifies SMS locally. It is reused without retraining on app startup.</p></article>
            <article><span className="about-number">02</span><h3>Neural translation</h3><p>Helsinki-NLP OPUS-MT English-to-Hindi model loads on first translation request and runs on CPU. Text is sent only to this app's backend.</p></article>
            <article><span className="about-number">03</span><h3>Honest assistance</h3><p>Reported test metrics are from the stored training report. Confidence is shown only when supported by the saved model.</p></article>
          </div>
          <div className="metrics-note"><Icon name="info" size={15} /> Model metrics are historical held-out test results, not a guarantee on new messages. Do not rely on this tool as a sole fraud-prevention measure.</div>
        </section>

        <footer className="page-footer"><span><Icon name="shield" size={15} /> ScamShield AI 2.0 <span className="footer-dot">•</span> Awareness &amp; educational use</span><a href="#dashboard">Back to top ↑</a></footer>
      </main>
      {demoActive && demoSpotlightPosition && <div className="demo-spotlight" style={demoSpotlightPosition} aria-hidden="true"><MousePointer2 size={22} /></div>}
    </div>
  )
}

export default App
